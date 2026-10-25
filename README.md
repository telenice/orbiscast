# OrbisCast

[![GitHub last commit](https://img.shields.io/github/last-commit/telenice/orbiscast)](https://github.com/telenice/orbiscast/commits/master)
[![GitHub issues](https://img.shields.io/github/issues/telenice/orbiscast)](https://github.com/telenice/orbiscast/issues)
[![GitHub license](https://img.shields.io/github/license/telenice/orbiscast)](https://github.com/telenice/orbiscast/blob/master/LICENSE.md)

**OrbisCast** is a Discord bot that streams IPTV channels into a Discord voice channel, so you can watch live TV together with friends. Pick a channel with a slash command, check what's on, search the TV guide for a team or show, and the bot goes live in your voice channel.

> This is a fork of [zbejas/orbiscast](https://github.com/zbejas/orbiscast) that adds Xtream Codes support, GPU transcoding, streamed guide loading and guide search. See [What this fork adds](#what-this-fork-adds).

> [!CAUTION]
> You are responsible for how you use this tool. Comply with all applicable copyright laws and make sure you have the rights to the IPTV content you stream.
>
> _OrbisCast streams through a regular Discord user account (a "self-bot"), which is against [Discord's terms of service](https://discord.com/guidelines) and may get that account banned. Use a secondary account, at your own risk._

## Features

- **Live streaming into voice channels** via Discord's Go Live, with audio.
- **Two kinds of IPTV source:** an M3U playlist URL, or an Xtream Codes account (server, username and password). Use either or both.
- **TV guide (EPG):** see what's on now and next for any channel, from an XMLTV guide or your Xtream provider's own guide. Large guides are filtered to your channels as they download.
- **Guide search:** `/search liverpool` lists upcoming matches with their times (in each viewer's own time zone), which channels show them, and a button to start watching.
- **Channel browsing:** paginated channel lists with buttons, and autocomplete in commands.
- **Smooth playback options:** re-encode streams into a Discord-friendly format, optionally capping resolution and frame rate (e.g. turn 4K 50 fps into 1080p 30 fps), or pass streams through untouched.
- **GPU transcoding:** encode on an Intel or AMD GPU (VAAPI) instead of the CPU.
- **Automatic upkeep:** channels and guide refresh on a schedule, and the stream stops by itself when nobody is watching.
- **Docker-ready**, with GPU drivers included in the image.

## How it works

Discord doesn't let bots send video, so OrbisCast uses two accounts:

- A **bot account** provides the slash commands.
- A **user account** joins the voice channel and does the actual streaming.

When someone runs `/stream`, the bot tells the user account to join their voice channel, and FFmpeg feeds it the IPTV stream.

## Getting started

### 1. Set up Discord

**Bot account**

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications), and copy the bot token.
2. Under **Bot → Privileged Gateway Intents**, enable **Message Content Intent**. The bot will not log in without it.
3. Under **OAuth2 → URL Generator**, tick the scopes **`bot`** and **`applications.commands`**, plus the permissions **View Channels**, **Send Messages** and **Embed Links**. Open the generated link to invite the bot to your server. Without the `applications.commands` scope, slash commands won't appear.

**User (streaming) account**

1. Use a secondary Discord account and join it to your server manually.
2. Make sure it has **Connect**, **Speak** and **Video** permissions in the voice channels you'll stream to.
3. Get its token from the Discord web client, for example with the method in [this gist](https://gist.github.com/MarvNC/e601f3603df22f36ebd3102c501116c6#file-get-discord-token-from-browser-md). Be careful with third-party tools that offer to fetch tokens; some are malicious.

> [!WARNING]
> Never share either token. If one leaks, regenerate the bot token in the Developer Portal, and log the user account out of all devices (Discord Settings → Devices) to invalidate its token.

### 2. Get an IPTV source

You need either an **M3U playlist URL** or **Xtream Codes credentials** from your provider. A guide is optional but recommended: an **XMLTV URL**, or the Xtream provider's own guide, which is used automatically.

> [!TIP]
> Tools like [Threadfin](https://github.com/Threadfin/Threadfin) or [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) are handy for curating channels. Public M3U playlists are available from [iptv-org](https://github.com/iptv-org/iptv), and [awesome-iptv](https://github.com/iptv-org/awesome-iptv) has more background.

### 3. Run it with Docker (recommended)

Clone this repository, create a `.env` file from `.env.example` (see [Configuration](#configuration)), then build and start the container:

```bash
git clone https://github.com/telenice/orbiscast
cd orbiscast
cp .env.example .env   # then edit .env
docker compose up -d --build
```

Follow the logs with `docker compose logs -f`. To update later, run `git pull` and then `docker compose up -d --build` again.

App data (the channel and guide database, and logs) is stored in `./data`. The download cache lives in RAM (`/dev/shm`) by default, or on disk if you set `RAM_CACHE=false`.

> [!NOTE]
> The official `zbejas/orbiscast` image on Docker Hub does not include this fork's features. Build from this repository, as above.

### Or run it manually

You need [Node.js](https://nodejs.org/) 22.4 or newer and [FFmpeg](https://ffmpeg.org/) on your `PATH`. The FFmpeg build must include libzmq (Debian's and Ubuntu's `ffmpeg` packages do).

```bash
git clone https://github.com/telenice/orbiscast
cd orbiscast
npm install
cp .env.example .env   # then edit .env
npm run build
npm run start:prod
```

Use `npm run dev` for auto-reload during development, or `npm start` to run straight from TypeScript.

## Configuration

All settings are environment variables, usually kept in a `.env` file (see `.env.example`). The minimum is the three Discord values plus one IPTV source.

**With an M3U playlist:**

```env
DISCORD_BOT_TOKEN="..."
DISCORD_USER_TOKEN="..."
GUILD=123456789012345678
PLAYLIST="http://example.com/playlist.m3u"
XMLTV="http://example.com/guide.xml"   # optional
```

**With an Xtream Codes account:**

```env
DISCORD_BOT_TOKEN="..."
DISCORD_USER_TOKEN="..."
GUILD=123456789012345678
XTREAM_HOST="http://example.com:8080"
XTREAM_USERNAME="..."
XTREAM_PASSWORD="..."
XTREAM_CATEGORIES="UK | Entertainment,UK | Sports"   # recommended
```

### Discord

| Variable | Description | Default | Required |
|---|---|---|---|
| `DISCORD_BOT_TOKEN` | Token of the bot account. | | ✔ |
| `DISCORD_USER_TOKEN` | Token of the user account that streams. | | ✔ |
| `GUILD` | ID of your Discord server. Turn on Developer Mode, then right-click the server and choose Copy Server ID. | | ✔ |

### IPTV sources

Configure `PLAYLIST`, the three `XTREAM_*` credentials, or both. If both are set, their channels are merged.

| Variable | Description | Default |
|---|---|---|
| `PLAYLIST` | URL of an M3U playlist. | |
| `XTREAM_HOST` | Xtream server URL, including the port. | |
| `XTREAM_USERNAME` | Xtream username. | |
| `XTREAM_PASSWORD` | Xtream password. | |
| `XTREAM_CATEGORIES` | Comma-separated category names or IDs to keep, e.g. `UK \| Sports,12`. Leave empty for all. | *(all)* |
| `XTREAM_OUTPUT` | Stream format: `ts` (MPEG-TS) or `m3u8` (HLS). | `ts` |

Xtream accounts often contain thousands of channels; `XTREAM_CATEGORIES` keeps the list manageable and makes guide loading much lighter. On startup the bot logs your Xtream account status, expiry date and connection limit. Credentials are masked in all logs.

### TV guide

| Variable | Description | Default |
|---|---|---|
| `XMLTV` | URL of an XMLTV guide. With Xtream, the provider's guide is used when this is unset. | |
| `XTREAM_EPG` | Use the Xtream provider's guide when `XMLTV` is unset. | `true` |
| `XMLTV_DAYS` | Days of upcoming listings to keep. `0` keeps everything. | `3` |
| `REFRESH_IPTV` | How often to refresh channels and guide, in minutes. | `1440` |

The guide is read as it downloads, and only listings for your channels are kept, so even a guide of several hundred MB loads with modest memory. Channels are matched to the guide by EPG ID (`tvg-id` / `epg_channel_id`) or by name. `/search` can only find what's in the stored guide, so raise `XMLTV_DAYS` to search further ahead.

### Streaming and quality

| Variable | Description | Default |
|---|---|---|
| `DISABLE_TRANSCODE` | `true` sends the stream to Discord as-is; `false` re-encodes it. | `false` |
| `BITRATE_VIDEO` | Target video bitrate in kbps when transcoding. | `5000` |
| `BITRATE_VIDEO_MAX` | Maximum video bitrate in kbps when transcoding. | `7500` |
| `STREAM_RESOLUTION` | Maximum output height when transcoding, e.g. `1080` or `720`. Unset keeps the source. | *(source)* |
| `STREAM_FPS` | Maximum output frame rate when transcoding, e.g. `30`. Unset keeps the source. | *(source)* |
| `ENCODER` | `software` (CPU) or `vaapi` (Intel/AMD GPU). | `software` |
| `VAAPI_DEVICE` | GPU device used with `ENCODER=vaapi`. | `/dev/dri/renderD128` |
| `HARDWARE_DECODING` | Decode the source on the GPU as well. | `true` with `vaapi`, else `false` |
| `MINIMIZE_LATENCY` | Reduce delay by disabling input buffering. Turn off if playback is choppy. | `true` |
| `DEFAULT_STREAM_TIMEOUT` | Minutes before the stream stops when nobody is watching. | `10` |

**Transcoding or passthrough?** Passthrough (`DISABLE_TRANSCODE=true`) uses almost no CPU, but sends whatever your provider broadcasts, which can include 4K at 50 fps and video features Discord handles poorly. Transcoding produces a stream built for Discord, with a steady bitrate, frequent keyframes and no B-frames. It is the most reliable way to get smooth playback.

**Resolution and frame-rate caps** only ever scale down. With `STREAM_RESOLUTION=1080` and `STREAM_FPS=30`, a 2160p 50 fps channel becomes 1080p 30 fps, while a 720p 25 fps channel stays as it is. For 50 fps sources, `STREAM_FPS=25` divides more evenly than `30`.

**GPU transcoding.** To encode on an Intel or AMD GPU, set `ENCODER=vaapi` and pass the GPU into the container in `compose.yml`:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

The Docker image includes the Intel and AMD VAAPI drivers. To check it's working:

- `docker exec orbiscast vainfo` should list H.264 with `VAEntrypointEncSlice`.
- While streaming, `sudo intel_gpu_top` on the host (from the `intel-gpu-tools` package) shows the `ffmpeg` process using the **Video** engine.

If the GPU device is missing, the bot logs an error and falls back to CPU encoding.

### System

| Variable | Description | Default |
|---|---|---|
| `TZ` | Container time zone, e.g. `Europe/London`. | `UTC` |
| `RAM_CACHE` | Keep downloads in RAM (`/dev/shm`) instead of on disk. | `true` |
| `CACHE_DIR` | Disk cache directory when `RAM_CACHE=false`. | `../cache` |
| `DEBUG` | Verbose logging. | `false` |

## Commands

| Command | Description |
|---|---|
| `/stream <channel>` | Start streaming a channel in your current voice channel. |
| `/stop` | Stop the stream. |
| `/channels [page]` | Browse all channels, with buttons to play them. |
| `/programme [channel]` | Show what's on now and next for a channel. Without a channel, pick one from a list. |
| `/search <query>` | Search the TV guide (e.g. `liverpool`) for what's on, when and on which channels, with buttons to watch. |
| `/refresh <type>` | Reload `all` data, just the `channels`, or just the `programme` guide. |

Channel names autocomplete in `/stream` and `/programme`. Discord shows at most 25 suggestions, so keep typing to narrow them down, or use `/channels` to browse everything.

`/search` requires every word to match, ignoring capitals, accents and punctuation. Programmes with the words in their title are listed first, ordered by start time with live ones at the top, followed by ones that only mention them in the description.

## Troubleshooting

- **Slash commands don't appear:** re-invite the bot with the `applications.commands` scope, and check that `GUILD` matches your server. The log lists the servers the bot is in if it doesn't. Commands register once the log shows `Successfully registered application commands.`, which happens after the channel data has loaded.
- **The bot doesn't log in ("disallowed intents"):** enable Message Content Intent in the Developer Portal.
- **Choppy playback:** try `MINIMIZE_LATENCY=false` first. If it persists, turn transcoding on (`DISABLE_TRANSCODE=false`), and cap high-resolution channels with `STREAM_RESOLUTION` / `STREAM_FPS`. If the CPU can't keep up, use `ENCODER=vaapi` with a GPU.
- **Stream starts but nobody sees video:** give the user account the **Video** permission in that voice channel.
- **Missing channels:** check the playlist URL or Xtream credentials (with Xtream, look for the account status line in the log), and `XTREAM_CATEGORIES`. Then run `/refresh channels`.
- **No guide, or "No guide entries matched your channels":** the channels' EPG IDs don't match the guide's channel IDs. Check that your playlist's `tvg-id` values, or your provider's EPG IDs, line up with the guide.
- **Stream freezes when the source drops:** the bot may not notice the source disconnecting. Run `/stop` and start the channel again, or restart the bot.

If you run into something not listed here, please [open an issue](https://github.com/telenice/orbiscast/issues).

## What this fork adds

Compared with [zbejas/orbiscast](https://github.com/zbejas/orbiscast):

- Xtream Codes API support, with category filtering and the provider's own guide
- Guide loading that streams and filters large guides, plus the `XMLTV_DAYS` window
- The `/search` command
- GPU (VAAPI) transcoding, and optional resolution and frame-rate caps
- Fixes: `MINIMIZE_LATENCY` no longer breaks every stream; a guide-only refresh no longer leaves channels unplayable; large guides no longer crash the bot; channels without an EPG ID can be streamed; credentials are masked in logs

## Development

```bash
npm run typecheck   # type-check the source
npm test            # run the test suite
npm run test:watch  # re-run tests on change
```

See [AGENTS.md](AGENTS.md) for an architecture overview.

## Credits

OrbisCast was created by [Zbejas](https://github.com/zbejas). Streaming is powered by [discord-video-stream](https://github.com/dank074/Discord-video-stream). Licensed under [GPL-3.0](LICENSE.md).
