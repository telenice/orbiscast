# OrbisCast

[![GitHub build status](https://img.shields.io/github/actions/workflow/status/zbejas/orbiscast/master.yml?label=master%20build)](https://github.com/zbejas/orbiscast/actions/workflows/master.yml)
[![GitHub last commit](https://img.shields.io/github/last-commit/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/commits/master)
[![GitHub issues](https://img.shields.io/github/issues/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/issues)
[![GitHub pull requests](https://img.shields.io/github/issues-pr/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/pulls)
[![GitHub license](https://img.shields.io/github/license/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/blob/master/LICENSE.md)
[![Release](https://img.shields.io/github/v/release/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/releases)
[![Repo size](https://img.shields.io/github/repo-size/zbejas/orbiscast)](https://github.com/zbejas/orbiscast/)
[![Docker Image Size (latest by date)](https://img.shields.io/docker/image-size/zbejas/orbiscast?sort=date)](https://hub.docker.com/r/zbejas/orbiscast)
[![Docker Pulls](https://img.shields.io/docker/pulls/zbejas/orbiscast)](https://hub.docker.com/r/zbejas/orbiscast)
[![CodeFactor](https://www.codefactor.io/repository/github/zbejas/orbiscast/badge)](https://www.codefactor.io/repository/github/zbejas/orbiscast)

**OrbisCast** is a Discord bot that streams IPTV channels. It can be controlled by users with [commands](#commands) specified at the end of this document.

The bot was made to simplify watch parties with friends. It is also useful for testing IPTV channels without the need for a dedicated IPTV player.

This project is still in development, so expect bugs and missing features. If you find any issues, please report them in the [Issues](https://github.com/zbejas/orbiscast/issues) section.

> [!CAUTION]
> I am not responsible for any misuse of this tool. Ensure to comply with all applicable copyright laws and obtain necessary permissions for the IPTV content being streamed.
>
> _Using self-bots is against [Discord's terms of service](https://discord.com/guidelines) and may result in account termination. Use at your own risk._

## Installation

### Before you start

You will need to set a few things up before you can run the bot:

- Create a bot on the [Discord Developer Portal](https://discord.com/developers/applications) and get the bot token, and invite the bot to your server.
  - You can follow the instructions [here](https://discordpy.readthedocs.io/en/stable/discord.html) to create a bot and get the token and invite link. Make sure to give the bot the necessary permissions:
    - `bot`
    - `applications.commands`
    - In the [Developer Portal](https://discord.com/developers/applications), go to your bot's settings and enable the `Message Content Intent`.
- Get the user token from the Discord web client.
  - The user token is required to join the voice channel and stream video. It is recommended to use a secondary account for this purpose.
    - The user has to manually join the server.
  - You can get the token by checking this [gist](https://gist.github.com/MarvNC/e601f3603df22f36ebd3102c501116c6#file-get-discord-token-from-browser-md) I found, or by using a tool like [Discord Get User Token](https://chromewebstore.google.com/detail/discord-get-user-token/accgjfooejbpdchkfpngkjjdekkcbnfd).
  - **Note**: Be careful when using any third-party tools to get your user token, as they may be malicious. I recommend using the method in the gist.
- Create a `.env` file in the project directory and fill in the required environment variables (see below). You can use the provided `.env.example` file as a template.

> [!WARNING]
> Do not share any of the tokens mentioned above with anyone. If you do, regenerate them immediately by:
>
> - Regenerating the bot token in the [Discord Developer Portal](https://discord.com/developers/applications).
> - Regenerating the user token by logging out and back in to Discord.
>   - If you used incognito mode to get the token, you can go to Discord Settings > Devices > Log out of all known devices (or just log out of the specific session).

### Docker

In the repo is a provided `compose.yml` file that can be used to run the bot.
Copy the file and fill in the required environment variables or create a `.env` file in the same directory as the `compose.yml` file.

Then, run the following command to start the bot:

```bash
docker compose up
```

or to run it in the background:

```bash
docker compose up -d
```

> [!TIP]
> You can check the logs using:
>
> ```bash
> docker compose logs -f
> ```
>
> _The `-f` flag is optional and is used to follow the logs._

All of the app data is stored in `/app/data`. The cache is stored in `/app/cache` or RAM, depending on the `RAM_CACHE` and `CACHE_DIR` environment variables.

You can check the available tags on the [Docker Hub page](https://hub.docker.com/r/zbejas/orbiscast/tags?ordering=name).

### Manual

> [!IMPORTANT]
> The following instructions are for running the bot manually. If you are using Docker, you can skip this section. [Node.js](https://nodejs.org/) v22.4 or higher is required, together with a working [FFmpeg](https://ffmpeg.org/) installation on your `PATH`.

The project can also be run manually. To do so, first download the project and install the dependencies:

```bash
git clone https://github.com/zbejas/orbiscast
cd orbiscast
npm install
```

For development with auto-reload:

```bash
npm run dev
```

For production, build and run:

```bash
npm run build
npm run start:prod
```

Or run directly with TypeScript:

```bash
npm start
```

### Development

Run the type checker and the test suite before opening a pull request:

```bash
npm run typecheck
npm test
```

Other useful scripts:

```bash
npm run test:watch    # re-run tests on change
npm run test:coverage # tests with coverage
```

See [AGENTS.md](AGENTS.md) for more detail on the project architecture.

## Environment Variables

The application uses the following environment variables, which should be defined in a `.env` file (see `.env.example`):

### System and IPTV Configuration

| Variable                 | Description                                                           | Example/Default                       | Required |
|--------------------------|-----------------------------------------------------------------------|---------------------------------------|----------|
| `PLAYLIST`               | URL to the M3U playlist. Required unless Xtream is configured.        | `http://example.com/m3u/playlist.m3u` | ✔*       |
| `XMLTV`                  | URL to the XMLTV guide. Defaults to the Xtream EPG when Xtream is set. | `http://example.com/xmltv/guide.xml`  | ✘        |
| `XTREAM_HOST`            | Xtream Codes server URL (with port). Required with Xtream.            | `http://example.com:8080`             | ✔*       |
| `XTREAM_USERNAME`        | Xtream account username.                                              | `username`                            | ✔*       |
| `XTREAM_PASSWORD`        | Xtream account password.                                              | `password`                            | ✔*       |
| `XTREAM_OUTPUT`          | Stream container: `ts` (MPEG-TS) or `m3u8` (HLS).                     | `ts`                                  | ✘        |
| `XTREAM_CATEGORIES`      | Comma-separated live category IDs or names to keep (empty = all).     | `UK \| News,12`                       | ✘        |
| `XTREAM_EPG`             | Use the provider's `xmltv.php` guide when `XMLTV` is not set.         | `true`                                | ✘        |
| `XMLTV_DAYS`             | Days of upcoming guide listings to keep (`0` = all).                  | `3`                                   | ✘        |
| `REFRESH_IPTV`           | Interval in minutes to refresh the IPTV data.                         | `1440`                                | ✘        |
| `RAM_CACHE`              | Whether to use RAM for caching.                                       | `true`                                | ✘        |
| `CACHE_DIR`              | Directory for cache storage.                                          | `../cache`                            | ✘        |
| `DEBUG`                  | Enable debug mode.                                                    | `false`                               | ✘        |
| `DEFAULT_STREAM_TIMEOUT` | Default stream timeout (when alone in channel) in minutes.            | `10`                                  | ✘        |
| `TZ`                     | Timezone for the container. Example: `Europe/Ljubljana`               | `UTC`                                 | ✘        |
| `MINIMIZE_LATENCY`       | Minimize latency for the stream.                                      | `true`                                | ✘        |
| `BITRATE_VIDEO`          | Video bitrate in Kbps.                                                | `5000`                                | ✘        |
| `BITRATE_VIDEO_MAX`      | Maximum video bitrate in Kbps.                                        | `7500`                                | ✘        |
| `DISABLE_TRANSCODE`      | Disable transcoding and pass stream through directly.                 | `false`                               | ✘        |
| `ENCODER`                | Video encoder when transcoding: `software` (CPU) or `vaapi` (GPU).    | `software`                            | ✘        |
| `VAAPI_DEVICE`           | GPU render node used with `ENCODER=vaapi`.                            | `/dev/dri/renderD128`                 | ✘        |
| `HARDWARE_DECODING`      | Decode the source on the GPU too. Defaults to on with `vaapi`.        | `false`                               | ✘        |
| `STREAM_RESOLUTION`      | Maximum output height, e.g. `1080` or `720`. Unset keeps the source.  | *(source)*                            | ✘        |
| `STREAM_FPS`             | Maximum output frame rate, e.g. `30`. Unset keeps the source.         | *(source)*                            | ✘        |

\* Configure **either** `PLAYLIST` **or** all three of `XTREAM_HOST`, `XTREAM_USERNAME` and `XTREAM_PASSWORD`. If both are set, channels from both sources are merged.

#### Xtream Codes API

If your provider gives you a server URL, username and password instead of an M3U link, set the `XTREAM_*` variables. OrbisCast reads live channels and categories from `player_api.php`, builds stream URLs as `<host>/live/<user>/<pass>/<id>.<ts|m3u8>`, and (unless you set `XMLTV` or `XTREAM_EPG=false`) loads the programme guide from the provider's `xmltv.php`. Credentials are masked in the logs.

Xtream accounts often contain thousands of channels; use `XTREAM_CATEGORIES` to keep only the categories you want. The guide is streamed and filtered as it downloads, so only listings for your channels are stored, even if the provider's full guide is hundreds of MB. Category names are matched case-insensitively against the provider's live category names.

> [!TIP]
> There is a bunch of IPTV providers online. I recommend using a tool like [Threadfin](https://github.com/Threadfin/Threadfin) or [Dispatcharr](https://github.com/Dispatcharr/Dispatcharr) to sort out your IPTV channels. You can find public M3U playlists [here](https://github.com/iptv-org/iptv). More info on IPTV can be found [here](https://github.com/iptv-org/awesome-iptv).

#### Transcoding, GPU encoding and output caps

When transcoding (`DISABLE_TRANSCODE=false`), OrbisCast re-encodes the stream to H.264 with no B-frames, a keyframe every second and the configured bitrate, which is the most reliable way to get smooth playback in Discord. By default it keeps the source's resolution and frame rate. Set `STREAM_RESOLUTION` and/or `STREAM_FPS` to cap them: sources above a cap are scaled down, sources at or below it are left untouched (never upscaled). For example `STREAM_RESOLUTION=1080` and `STREAM_FPS=30` turn a 2160p 50 fps channel into 1080p 30 fps, while a 720p 25 fps channel stays as it is. These settings have no effect with `DISABLE_TRANSCODE=true`.

To encode on an Intel (or AMD) GPU instead of the CPU, set `ENCODER=vaapi` and pass the GPU into the container:

```yaml
    devices:
      - /dev/dri:/dev/dri
```

The Docker image includes the Intel and AMD VAAPI drivers. Run `docker exec orbiscast vainfo` to check the GPU is visible; it should list `VAEntrypointEncSlice` for H.264. If the device is missing, OrbisCast logs an error and falls back to CPU encoding. If the host has more than one GPU, set `VAAPI_DEVICE` to the right render node (`ls /dev/dri`).

### Discord Configuration

The reason we have a `bot` and a `user` token is because the current Discord API does not allow bots to stream video. The bot is used to control the user, which is the one that actually streams the video.

| Variable              | Description                                      | Example/Default                          | Required |
|-----------------------|--------------------------------------------------|------------------------------------------|----------|
| `DISCORD_BOT_TOKEN`           | Token for the Discord bot.                       | `YOUR_BOT_TOKEN_HERE`                    | ✔        |
| `DISCORD_USER_TOKEN`  | Token for the Discord user.                      | `YOUR_USER_TOKEN_HERE`                   | ✔        |
| `GUILD`               | Discord guild (server) ID.                       | `000000000000000000`                     | ✔        |

## Commands

The bot can be controlled using the following commands:

| Command | Description |
|---------|-------------|
| `/stream <channel>` | Start streaming the specified channel. |
| `/programme <channel>` | Show the current programme for the specified channel. |
| `/channels <page>` | List all available channels. Page is optional. |
| `/search <query>` | Search the TV guide (e.g. `liverpool`) and see when it's on and on which channels, with buttons to watch. |
| `/stop` | Stop the current stream. |
| `/refresh <type>` | Refresh the specified data. Type can be "all", "channels", or "programme". |

> [!TIP]
> Both `/channels` and `/programme` commands support autocompletion for channel names. However, Discord limits the number of options shown at once to 25. Use the `/channels` or `/programme` command to see all available channels. The bot will show the first 25 channels, and you can use the `page` argument to see more.

## Troubleshooting

If you encounter any issues, here are some common problems and their solutions:

- **Stream freezes or hangs**: If the stream source gets disconnected or the stream is killed from the source side, the bot may hang indefinitely. Currently, there's no automatic detection for this issue, so you'll need to restart the bot.

- **Stream quality issues**: If you're experiencing quality problems, try adjusting the `BITRATE_VIDEO` and `BITRATE_VIDEO_MAX` environment variables to values that work better with your network conditions.

- **High latency**: Enable the `MINIMIZE_LATENCY` option in your environment variables to reduce streaming delay.

- **Missing channels**: Make sure your M3U playlist URL (or Xtream host and credentials) is correct and accessible. With Xtream, check the log line reporting your account status and expiry date. You can use the `/refresh channels` command to reload the channel list.

- **Authorization errors**: If the bot can't join voice channels or execute commands, verify that both the bot and user tokens are correct and have the necessary permissions.

If you encounter issues not listed here, please open a new [issue](https://github.com/zbejas/orbiscast/issues) with details about your problem.
  
> [!NOTE]
> In my testing, I've been using tools mentioned in the [System and IPTV Configuration](#system-and-iptv-configuration) tip to sort out the channels. It should work with any M3U or HDHR playlist, but I cannot guarantee it. This tool was not built or tested with a large number of channels, so it may not work as expected if you overload it with data. For any issues, please open a new [issue](https://github.com/zbejas/orbiscast/issues).
