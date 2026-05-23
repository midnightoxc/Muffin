# Simple VC Countdown Discord Bot

A Discord bot that plays audio countdown sequences in voice channels using Master Chief voice files.

## Features

- `/muffin` slash command for join/leave/countdown/stop
- Owner-only debug message commands for status, voice diagnostics, recent errors, and dependency reports
- Plays audio files sequentially in voice channels
- Guild-specific commands for faster deployment
- Modular command structure

## Setup

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Configure Environment Variables**

   Edit the `.env` file with your bot credentials:

   ```env
   DISCORD_TOKEN=your_bot_token_here
   CLIENT_ID=your_client_id_here
   GUILD_ID=your_guild_id_here
   OWNER_ID=your_discord_user_id_here
   OWNER_IDS=comma_separated_owner_user_ids_optional
   DEBUG_PREFIX=!debug
   ENABLE_MESSAGE_DEBUG=false
   ```

   If you want message-based debug commands to work, set `ENABLE_MESSAGE_DEBUG=true` and enable the Message Content intent in the Discord Developer Portal.
   Only configured owner IDs can use the debug message commands, and non-owners are silently ignored.

3. **Deploy Commands**

   ```bash
   npm run deploy
   ```

4. **Start the Bot**
   ```bash
   npm start
   ```

## Bot Permissions

The bot requires the following permissions:

- `Send Messages`
- `Use Slash Commands`
- `Connect` (to voice channels)
- `Speak` (in voice channels)

## Audio Files

Audio files should be placed in the `countdown_audio/` directory and named as `{number}.mp4` (e.g., `5.mp4`, `6.mp4`, etc.).

## Commands

### `/muffin cd`

Starts an audio countdown in your current voice channel.

**Parameters:**

- `duration` (required): One of 10, 20, 30, 40, 50, 60 seconds

**Usage:**

```
/muffin cd duration:10
```

### `/muffin join`

Joins your current voice channel.

### `/muffin stop`

Stops the current countdown audio without making the bot leave the voice channel. The stopped audio resource is discarded, so it cannot be resumed. Start a new countdown with `/muffin cd`.

### `/muffin leave`

Leaves the current guild voice connection.

### `!debug status`

Shows runtime health such as uptime, ping, memory usage, and loaded commands.

### `!debug voice`

Shows current voice connection state and the last recorded voice event for the guild.

### `!debug errors`

Shows the most recent in-memory runtime errors captured by the bot.

### `!debug deps`

Shows the `@discordjs/voice` dependency report from inside Discord.

The debug command prefix is configurable with `DEBUG_PREFIX`.
Message debug commands are only active when `ENABLE_MESSAGE_DEBUG=true`.

## Project Structure

```
├── commands/
│   └── countdown.js
├── countdown_audio/
│   ├── 5.mp4
│   ├── 6.mp4
│   └── ...
├── .env
├── index.js
├── deploy-commands.js
├── package.json
└── README.md
```

## Development

The bot uses a modular command structure where each command is a separate file in the `commands/` directory. This makes it easy to add new commands by creating new command files.

## License

MIT License - see LICENSE file for details.
