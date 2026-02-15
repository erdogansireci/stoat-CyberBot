# Stoat CyberBot

A simple music bot for Stoat.chat that can join a voice channel and play audio from YouTube links.

## Features

- `ping` health-check command
- Join a voice channel
- Queue and play YouTube links
- Skip, stop, and list queue items

## Requirements

- Node.js `18+` (recommended: `20+`)
- `yt-dlp` installed on your system and available in terminal
- A Stoat bot token

## Installation

```bash
npm install
```

Create a `.env` file:

```env
STOAT_BOT_TOKEN=BOT_TOKEN_HERE
PREFIX=!
```

## Run

```bash
npm start
```

On successful startup, you should see a `Bot online: ...` log in the terminal.

## Commands

Default prefix: `!` (can be changed with `PREFIX` in `.env`)

- `!ping`  
  Checks whether the bot is online.

- `!join <voiceChannelId>`  
  Connects the bot to the given voice channel.

- `!play <youtube_link>`  
  Adds a YouTube link to the queue and starts playback if idle.

- `!skip`  
  Skips the current track and moves to the next one.

- `!stop`  
  Stops playback and clears the queue.

- `!queue`  
  Lists the first 10 items in the queue.

## Example Usage

```text
!join 1234567890abcdef
!play https://www.youtube.com/watch?v=dQw4w9WgXcQ
!queue
!skip
!stop
```

## Notes

- `!play` currently accepts direct YouTube links only.
- The queue is kept in memory and resets when the bot restarts.
- If `yt-dlp` is not installed, playback commands will fail.
