# Stoat CyberBot

A music bot for Stoat (works with self-hosted servers). It plays songs from links or search keywords, plus internet radio, in a voice channel.

## Features

- **Smart search:** cleans titles, checks the official name, and skips previews, remixes and covers unless you ask for them
- **Free sources, no API keys:** SoundCloud → Audius → Bandcamp → Mixcloud → Internet Archive. If one source fails, the next one is tried
- **Links:** links from the sources above play directly. Spotify, Deezer, Apple Music and YouTube links are searched by song name
- **Internet radio:** about 50,000 stations via Radio-Browser
- **Easy joining:** `!join` comes to your voice channel, and `!play` joins automatically
- **Clean chat:** short messages only, no links or raw errors. Details go to the log
- **Modular:** new integrations are added as separate command modules

## Commands

| Command | Description |
|---|---|
| `!join [name \| #channel \| ID]` | Joins your voice channel, or the one you name |
| `!leave` | Leaves the voice channel |
| `!play <link \| song>` (`!p`) | Plays a song or adds it to the queue |
| `!skip` | Skips the current song or radio |
| `!stop` | Stops playback and clears the queue |
| `!clear` | Clears the queue; the current song keeps playing |
| `!queue` (`!q`) | Shows the current song and the queue |
| `!radio <genre \| station>` | Plays the most popular matching station, e.g. `!radio lofi` |
| `!radio liste <genre>` / `!radio <n>` | Lists the top 5 stations / plays station number n |
| `!help` | Lists all commands |
| `!version` (`!versiyon`) | Shows the bot version |
| `!ping` | Checks that the bot is online |

## Setup

Copy `.env.example` to `.env` and fill it in:

| Variable | Description |
|---|---|
| `STOAT_BOT_TOKEN` | Bot token (Stoat → Settings → My Bots) |
| `STOAT_API_URL` | Your Stoat API URL (default `https://stoat.chat/api`) |
| `PREFIX` | Command prefix (default `!`) |
| `MUSIC_SOURCES` | Search order (default `soundcloud,audius,bandcamp,mixcloud,archive`; `youtube` is also available) |
| `YTDLP_COOKIES` | Optional YouTube cookie file, used only when `youtube` is enabled |

Docker:

```bash
docker compose up -d --build
docker compose logs -f --tail 30
```

Local: Node.js 20+ and `yt-dlp` in `PATH`, then `npm install && npm start`.

## Adding a module

Create `src/modules/<name>/index.js`. It should return `{ name, commands: [{ name, usage, description, run(ctx) }] }`. Then register it in `src/index.js` with `router.use(myModule(bot))`. It appears in `!help` automatically.

To add a music source, create a file in `src/modules/music/sources/` that exports `{ id, name, matchesHost, search, fromUrl, open }`, then add it to `sources/index.js`.
