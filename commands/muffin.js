const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    NoSubscriberBehavior,
    StreamType,
    entersState,
    getVoiceConnection,
} = require('@discordjs/voice');
const path = require('path');
const fs = require('fs');
const { recordError, recordGuildVoiceEvent } = require('../utils/debug-store');

const VOICE_READY_TIMEOUT_MS = 15_000;
const PLAYER_READY_TIMEOUT_MS = 10_000;
const CONNECTION_LISTENERS_ATTACHED = Symbol('connectionListenersAttached');
const guildPlayers = new Map();

function safeDestroyConnection(connection) {
    if (connection.state.status !== VoiceConnectionStatus.Destroyed) {
        connection.destroy();
    }
}

function createVoiceStageError(stage, message, error) {
    const wrappedError = new Error(message, { cause: error });
    wrappedError.stage = stage;
    wrappedError.code = error?.code;
    return wrappedError;
}

function getUserFacingVoiceError(error) {
    if (error?.stage === 'connection_ready') {
        return 'I could not finish joining the voice channel in time. Please try the command again in a moment.';
    }

    if (error?.stage === 'player_playing') {
        return 'I joined the voice channel, but the countdown audio did not start in time. Please try again.';
    }

    return 'There was an error starting the countdown. Check the bot logs for the voice/DAVE dependency report.';
}

async function ensureReadyConnection(voiceChannel) {
    const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: voiceChannel.guild.id,
        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
        selfDeaf: true,
    });

    if (!connection[CONNECTION_LISTENERS_ATTACHED]) {
        connection.on('error', (error) => {
            console.error(`Voice connection error in guild ${voiceChannel.guild.id}:`, error);
            recordError('voice.connection', error, {
                guildId: voiceChannel.guild.id,
                channelId: voiceChannel.id,
            });
        });

        connection.on(VoiceConnectionStatus.Disconnected, async () => {
            try {
                await Promise.race([
                    entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                    entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                ]);
            } catch {
                safeDestroyConnection(connection);
            }
        });

        connection[CONNECTION_LISTENERS_ATTACHED] = true;
    }

    try {
        await entersState(connection, VoiceConnectionStatus.Ready, VOICE_READY_TIMEOUT_MS);
    } catch (error) {
        safeDestroyConnection(connection);
        throw createVoiceStageError(
            'connection_ready',
            `Voice connection did not become ready within ${VOICE_READY_TIMEOUT_MS}ms`,
            error
        );
    }

    return connection;
}

function hasVoicePermissions(voiceChannel, clientUser) {
    const permissions = voiceChannel.permissionsFor(clientUser);
    return Boolean(
        permissions?.has(PermissionFlagsBits.Connect) &&
        permissions.has(PermissionFlagsBits.Speak)
    );
}

function getOrCreateGuildPlayer(guildId) {
    const existingPlayer = guildPlayers.get(guildId);
    if (existingPlayer) {
        return existingPlayer;
    }

    const player = createAudioPlayer({
        behaviors: {
            noSubscriber: NoSubscriberBehavior.Pause,
            maxMissedFrames: Math.round(5000 / 20) // 5 seconds of missed frames
        }
    });

    player.on('error', (error) => {
        console.error(`Audio player error in guild ${guildId}:`, error);
    });

    player.on(AudioPlayerStatus.Idle, () => {
        console.log(`Countdown finished in guild ${guildId}`);
    });

    guildPlayers.set(guildId, player);
    return player;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('muffin')
        .setDescription('Muffin bot commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('cd')
                .setDescription('Start a countdown with audio in the voice channel')
                .addStringOption(option =>
                    option.setName('duration')
                        .setDescription('Select countdown duration')
                        .setRequired(true)
                        .addChoices(
                            { name: '10 seconds', value: '10' },
                            { name: '20 seconds', value: '20' },
                            { name: '30 seconds', value: '30' },
                            { name: '40 seconds', value: '40' },
                            { name: '50 seconds', value: '50' },
                            { name: '60 seconds', value: '60' }
                        )
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('join')
                .setDescription('Join your voice channel')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('Stop the current countdown without leaving voice')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leave')
                .setDescription('Leave the voice channel')
        ),
    
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'cd') {
            return await this.handleCountdown(interaction);
        } else if (subcommand === 'join') {
            return await this.handleJoin(interaction);
        } else if (subcommand === 'stop') {
            return await this.handleStop(interaction);
        } else if (subcommand === 'leave') {
            return await this.handleLeave(interaction);
        }
    },

    async handleCountdown(interaction) {
        const countdownDuration = interaction.options.getString('duration');
        
        // Check if user is in a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply({
                content: 'You need to be in a voice channel to use this command!',
                ephemeral: true
            });
        }

        // Check bot permissions
        if (!hasVoicePermissions(voiceChannel, interaction.client.user)) {
            return await interaction.reply({
                content: 'I need permission to connect and speak in your voice channel!',
                ephemeral: true
            });
        }

        const audioPath = path.join(__dirname, '..', 'countdown_audio', `${countdownDuration}SecondHaloCD.mp4`);
        
        // Check if audio file exists
        if (!fs.existsSync(audioPath)) {
            return await interaction.reply({
                content: `${countdownDuration}SecondHaloCD.mp4 audio file not found!`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        try {
            const connection = await ensureReadyConnection(voiceChannel);
            const player = getOrCreateGuildPlayer(interaction.guild.id);
            connection.subscribe(player);
            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'countdown_starting',
                channelId: voiceChannel.id,
                duration: countdownDuration,
            });

            // Create audio resource - no seeking needed since each file is complete
            const resource = createAudioResource(audioPath, {
                inputType: StreamType.Arbitrary,
                metadata: { title: `${countdownDuration} second countdown` }
            });

            player.play(resource);
            try {
                await entersState(player, AudioPlayerStatus.Playing, PLAYER_READY_TIMEOUT_MS);
            } catch (error) {
                throw createVoiceStageError(
                    'player_playing',
                    `Audio player did not reach Playing within ${PLAYER_READY_TIMEOUT_MS}ms`,
                    error
                );
            }

            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'countdown_started',
                channelId: voiceChannel.id,
                duration: countdownDuration,
            });
            await interaction.editReply(`Starting ${countdownDuration} second countdown!`);

        } catch (error) {
            console.error(`Error in countdown command [stage=${error?.stage ?? 'unknown'} code=${error?.code ?? 'n/a'}]:`, error);
            recordError('muffin.countdown', error, {
                guildId: interaction.guildId,
                channelId: voiceChannel.id,
                duration: countdownDuration,
            });
            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'countdown_error',
                channelId: voiceChannel.id,
                duration: countdownDuration,
                stage: error?.stage ?? null,
                message: error?.message ?? String(error),
            });

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(getUserFacingVoiceError(error));
            } else {
                await interaction.reply({
                    content: getUserFacingVoiceError(error),
                    ephemeral: true
                });
            }
        }
    },

    async handleJoin(interaction) {
        // Check if user is in a voice channel
        const voiceChannel = interaction.member.voice.channel;
        if (!voiceChannel) {
            return await interaction.reply({
                content: 'You need to be in a voice channel for me to join!',
                ephemeral: true
            });
        }

        // Check bot permissions
        if (!hasVoicePermissions(voiceChannel, interaction.client.user)) {
            return await interaction.reply({
                content: 'I need permission to connect and speak in your voice channel!',
                ephemeral: true
            });
        }

        try {
            await interaction.deferReply();
            await ensureReadyConnection(voiceChannel);
            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'joined',
                channelId: voiceChannel.id,
            });
            await interaction.editReply(`Joined **${voiceChannel.name}** and completed the voice handshake.`);

        } catch (error) {
            console.error(`Error joining voice channel [stage=${error?.stage ?? 'unknown'} code=${error?.code ?? 'n/a'}]:`, error);
            recordError('muffin.join', error, {
                guildId: interaction.guildId,
                channelId: voiceChannel.id,
            });
            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'join_error',
                channelId: voiceChannel.id,
                stage: error?.stage ?? null,
                message: error?.message ?? String(error),
            });

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply(getUserFacingVoiceError(error));
            } else {
                await interaction.reply({
                    content: getUserFacingVoiceError(error),
                    ephemeral: true
                });
            }
        }
    },

    async handleStop(interaction) {
        const player = guildPlayers.get(interaction.guild.id);

        if (!player || player.state.status === AudioPlayerStatus.Idle) {
            return await interaction.reply({
                content: 'No countdown is currently playing.',
                ephemeral: true
            });
        }

        const stopped = player.stop(true);
        recordGuildVoiceEvent(interaction.guild.id, {
            type: 'countdown_stopped',
        });

        if (!stopped) {
            return await interaction.reply({
                content: 'No countdown is currently playing.',
                ephemeral: true
            });
        }

        await interaction.reply('Stopped the countdown.');
    },

    async handleLeave(interaction) {
        try {
            // Get existing voice connection
            const connection = getVoiceConnection(interaction.guild.id);
            
            if (!connection) {
                return await interaction.reply({
                    content: "I'm not currently in a voice channel!",
                    ephemeral: true
                });
            }

            // Destroy the connection
            safeDestroyConnection(connection);
            const player = guildPlayers.get(interaction.guild.id);
            player?.stop(true);
            recordGuildVoiceEvent(interaction.guild.id, {
                type: 'left',
                channelId: connection.joinConfig.channelId ?? null,
            });

            await interaction.reply('👋 Left the voice channel!');

        } catch (error) {
            console.error('Error leaving voice channel:', error);
            recordError('muffin.leave', error, {
                guildId: interaction.guildId,
            });
            await interaction.reply({
                content: 'There was an error leaving the voice channel!',
                ephemeral: true
            });
        }
    },
};
