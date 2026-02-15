# Stoat CyberBot

A simple music bot for Stoat.chat that can join a voice channel and play audio from YouTube links or search keywords.

## Features

- `ping` health-check command
- Join a voice channel
- Queue and play YouTube links
- Search YouTube by keywords and play the first result
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

- `!play <youtube_link | search_keywords>`  
  Accepts either a direct YouTube link or search keywords.  
  If keywords are provided, the bot searches YouTube and queues the first result.

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
!play daft punk harder better faster stronger
!queue
!skip
!stop
```

## Notes

- For keyword searches, the bot resolves `ytsearch1:<query>` and uses the first result.
- When a search query is used, the bot sends the resolved first result (title/link) before queueing.
- The queue is kept in memory and resets when the bot restarts.
- If `yt-dlp` is not installed, playback commands will fail.
