# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

OrbisCast is a Discord bot that streams IPTV channels into Discord voice
channels. It uses a **bot token** to expose slash commands and a **user
(self-bot) token** to actually stream video, because Discord does not allow
regular bots to send video.

> [!CAUTION]
> Self-bots violate Discord's Terms of Service and can get an account banned.
> Never commit real tokens or credentials. All configuration is read from
> environment variables / `.env` (git-ignored).

## Tech stack

- **Language:** TypeScript, compiled to **CommonJS** (`tsconfig.json`, no
  `"type": "module"` in `package.json`). `__dirname` is valid and used for path
  resolution — do not switch the project to ESM without updating
  `src/utils/logger.ts` and `src/modules/database/index.ts`.
- **Runtime:** Node.js >= 22.4 (see `engines` in `package.json` and `.nvmrc`).
- **Bot client:** `discord.js` v14.
- **Streaming:** `@dank074/discord-video-stream` v7 + its peer dependency
  `@lng2004/discord.js-selfbot-v13` (a fork of `discord.js-selfbot-v13`). v7
  uses WebRTC (`node-datachannel`, `node-av`) and supports Discord E2EE (DAVE).
- **Storage:** `lowdb` (JSON files under `data/`).
- **Logging:** `winston` (console + rotating file in `data/logs/app.log`).
- **HTTP:** `axios`.
- **Tests:** Vitest (`vitest.config.mts`, tests in `test/`).

## Requirements

- Node.js >= 22.4
- FFmpeg available on `PATH`, **built with libzmq** (the `azmq` audio filter).
  discord-video-stream v7 uses `azmq` for volume control; a plain FFmpeg build
  without it will fail. Debian's `ffmpeg` package has it; the static builds
  bundled inside `node-av` do **not**.
- An M3U playlist URL, and optionally an XMLTV guide URL

### Docker base image

`node-av` and `node-datachannel` (dependencies of discord-video-stream v7) ship
prebuilt native bindings that require a recent **glibc** (node-datachannel needs
`GLIBC_2.38+`), so the image must be glibc-based and new enough. The Dockerfile
uses `node:22-trixie-slim` (glibc 2.41), not Alpine (musl) — Alpine fails with
`Error loading shared library libmvec.so.1`, and `bookworm` (glibc 2.36) fails
with `version 'GLIBC_2.38' not found`. The runtime image installs Debian
`ffmpeg`, which includes `azmq`.

## Repository layout

```
src/
  index.ts                       Entry point: boot, login, graceful shutdown
  interfaces/iptv.ts             ChannelEntry / ProgrammeEntry types
  utils/
    config.ts                    Env parsing + validation (singleton `config`)
    logger.ts                    Winston logger; loads dotenv first
    discord.ts                   discord.js bot client + slash command wiring
    cache.ts                     File cache helpers (RAM or disk)
    channels.ts                  Channel name <-> custom ID sanitization helpers
  modules/
    streaming/index.ts           Streamer lifecycle (join/leave/start/stop)
    commands/                    Slash command handlers (stream, stop, list, ...)
    embeds/                      Embed builders (base, channel, programme)
    iptv/                        Playlist/XMLTV download + parsing + scheduling
      parsers/                   M3U and XMLTV parsers
    database/index.ts            lowdb persistence
test/                            Vitest tests
.github/workflows/               CI + Docker release workflows
```

## Commands

```bash
npm install          # install dependencies
npm run dev          # run with auto-reload (tsx watch)
npm start            # run directly from TypeScript (tsx)
npm run build        # compile to dist/ with tsc
npm run start:prod   # run the compiled output (node dist/index.js)
npm run typecheck    # tsc --noEmit (src)
npm test             # vitest run
npm run test:watch   # vitest watch mode
npm run test:coverage# vitest with coverage
```

Before proposing changes, run **`npm run typecheck`** and **`npm test`**. Both
must pass. Also run `npx tsc -p tsconfig.test.json` when touching tests.

## How it works

### Startup (`src/index.ts`)

1. `initializeStreamer()` — logs in the self-bot streaming client.
2. `downloadCacheAndFillDb()` — downloads/caches IPTV data and populates the DB.
3. `client.login(...)` — logs in the discord.js bot client.
4. `SIGINT`/`SIGTERM` trigger a graceful shutdown (stops the IPTV refresh
   scheduler, logs out the streamer, destroys the Discord client).

`dotenv` is loaded as the first import of `src/utils/logger.ts`, so `.env` is
read before `config` or any other module inspects `process.env`. Keep that
ordering: if you add a module that reads `process.env` at import time, import
`dotenv/config` before it or rely on `logger`.

### IPTV pipeline (`src/modules/iptv/`)

- `downloadCacheAndFillDb()` is the entry point. If `XMLTV` is set it parses the
  guide (channels + programmes), then if `PLAYLIST` is set it merges stream URLs
  from the M3U. Playlist-only mode is supported.
- `downloaders.ts` fetches with retries, exponential backoff, a 30s timeout and
  a 50 MB size cap, caching results via `utils/cache`.
- `parsers/playlist-parser.ts` tries several `#EXTINF` attribute layouts.
- `parsers/xmltv-parser.ts` uses `xml2js`; `utils.ts#parseDate` handles XMLTV
  timestamps (`YYYYMMDDHHMMSS +/-HHMM`) as UTC.
- `schedulers.ts` refreshes on `REFRESH_IPTV` (minutes).

### Streaming (`src/modules/streaming/index.ts`)

- `joinVoiceChannel(guildId, channelId)` returns a `boolean`. It leaves any
  existing connection, joins the requested channel, and **times out after 20s**
  so a stuck voice handshake cannot hang a slash command. Prefer this over
  checking connection state yourself.
- `startStreaming(channel)` builds an FFmpeg pipeline with `prepareStream`
  (software encoder, H.264) and plays it with `playStream` in `go-live` mode.
  The returned FFmpeg promise is explicitly handled so it never becomes an
  unhandled rejection.
- `stopStreaming()` aborts playback, clears the spectator monitor and resets
  state. `leaveVoiceChannel()` stops and disconnects.
- A spectator monitor stops the stream after `DEFAULT_STREAM_TIMEOUT` minutes
  with no non-bot viewers.

### Discord bot (`src/utils/discord.ts`)

- Registers guild slash commands on `ready` and dispatches interactions.
- Autocomplete always responds (even with an empty list) and caps choices at 25.
- Component custom IDs are limited to 100 characters, so channel names are
  sanitized with `utils/channels.ts#sanitizeChannelId` and resolved back with
  `findChannelBySanitizedId`. Use these helpers for any new channel buttons.

## Environment variables

See `.env.example` and the README table. Required: `PLAYLIST`,
`DISCORD_BOT_TOKEN`, `DISCORD_USER_TOKEN`, `GUILD`. Optional: `XMLTV`,
`REFRESH_IPTV`, `RAM_CACHE`, `CACHE_DIR`, `DEBUG`, `DEFAULT_STREAM_TIMEOUT`,
`TZ`, `MINIMIZE_LATENCY`, `BITRATE_VIDEO`, `BITRATE_VIDEO_MAX`,
`DISABLE_TRANSCODE`.

`RAM_CACHE` defaults to `true` but only takes effect when `/dev/shm` exists
(Linux). Otherwise it falls back to `CACHE_DIR` (default `../cache`).

## Coding conventions

- Match the existing style: 4-space indentation, single quotes in TS, JSDoc on
  exported functions.
- Keep changes small and focused. Prefer the existing module boundaries.
- Never log tokens or full credentials; use `config`'s sanitized logging.
- Add a test for pure logic (parsers, date handling, embed content, helpers).
- Do not commit `node_modules`, `dist/`, `data/`, `cache/`, or `.env`.

## Testing notes

- Tests live in `test/` and run with Vitest.
- `vitest.config.mts` injects dummy env vars so `config` validates cleanly.
- Tests must not require Discord tokens or network access. Mock or avoid
  network calls.
- Native FFmpeg/WebRTC code is not exercised in unit tests.

## Known upstream issues

- `tsx` (used by `npm start` / `npm run dev`) cannot resolve
  `unicorn-magic@0.3.0` because its conditional exports are import-only. Plain
  Node and the compiled `dist` build are unaffected. `package.json` overrides
  `unicorn-magic` to `^0.4.1` (same `toPath`/`traversePathUp` API, proper
  `default` conditions); keep that override until `npm-run-path` updates.
- `npm audit` reports high-severity issues in the transitive `ip` package
  (`ip` <- `werift` <- `node-av` <- `@dank074/discord-video-stream`). There is no
  non-breaking fix upstream yet; `npm audit fix --force` would downgrade the
  streaming library, so do not run it.
- Discord voice now negotiates E2EE (DAVE). Old versions of the streaming
  library could join a voice channel but never send media; v7 handles this.

## Pull requests

- Branch from `master`, keep commits scoped and descriptive.
- CI (`.github/workflows/ci.yml`) runs typecheck and tests on pushes/PRs.
- The `dev` and `master` workflows build/publish Docker images; `master`
  publishes on GitHub release.
