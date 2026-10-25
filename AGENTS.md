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
- An M3U playlist URL or Xtream Codes credentials, and optionally an XMLTV guide URL

### Docker base image

`node-av` and `node-datachannel` (dependencies of discord-video-stream v7) ship
prebuilt native bindings that require a recent **glibc** (node-datachannel needs
`GLIBC_2.38+`), so the image must be glibc-based and new enough. The Dockerfile
uses `node:22-trixie-slim` (glibc 2.41), not Alpine (musl) — Alpine fails with
`Error loading shared library libmvec.so.1`, and `bookworm` (glibc 2.36) fails
with `version 'GLIBC_2.38' not found`. The runtime image installs Debian
`ffmpeg`, which includes `azmq`, plus VAAPI drivers (Intel non-free driver
from Debian `non-free` on amd64, `i965`, Mesa) for `ENCODER=vaapi`.

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
      xtream.ts                  Xtream Codes API client (player_api.php)
      parsers/                   M3U, XMLTV and Xtream parsers
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
   scheduler, disconnects the streamer **without logging it out**, destroys the
   Discord client). Never call `Client#logout()` on the self-bot: it revokes the
   user token. Use `shutdownStreamer()` (which calls `destroy()`).

`dotenv` is loaded as the first import of `src/utils/logger.ts`, so `.env` is
read before `config` or any other module inspects `process.env`. Keep that
ordering: if you add a module that reads `process.env` at import time, import
`dotenv/config` before it or rely on `logger`.

### IPTV pipeline (`src/modules/iptv/`)

- `downloadCacheAndFillDb()` is the entry point. It fetches playable channels
  from the M3U (`PLAYLIST`) and/or the Xtream API (`XTREAM_*`) first, then, if
  `XMLTV` is set, streams the guide keeping only entries for those channels
  (matched by tvg-id or name), then merges the stream URLs. Playlist-only mode is
  supported. When Xtream is configured and `XMLTV` is unset, `config`
  points `XMLTV` at the provider's `xmltv.php`.
- XMLTV refreshes keep stream URLs from the previous channel sync, so a
  programme-only refresh does not leave channels unplayable.
- Never log raw stream or source URLs; pass them through
  `utils/redact.ts#redactUrl` (Xtream URLs embed the username and password).
- `downloaders.ts#fetchWithRetry` buffers small files (playlists, Xtream JSON)
  with retries, a 30s timeout and a 50 MB cap, caching via `utils/cache`.
  `streamWithRetry` streams large files (the XMLTV guide) with no size cap and
  gunzips `.gz`/gzip content on the fly.
- Channel merging lives in `merge.ts` (pure, unit-tested): guide-only channels
  are kept, previously synced channels are rebuilt from the sources, and each
  source channel claims at most one guide channel (by name, then tvg-id).
  Same-named source channels stay separate; only duplicate stream URLs are dropped.
- `parsers/playlist-parser.ts` tries several `#EXTINF` attribute layouts.
- `parsers/xmltv-parser.ts` is a streaming `sax` parser: it materialises one
  `<channel>`/`<programme>` at a time (in xml2js shape), filters by wanted
  channels and the `XMLTV_DAYS` window, and tolerates malformed XML. Never use
  `Math.min(...arr)`/`push(...arr)` on guide-sized arrays (stack overflow).
  `utils.ts#parseDate` handles XMLTV timestamps (`YYYYMMDDHHMMSS +/-HHMM`) as UTC.
- `schedulers.ts` refreshes on `REFRESH_IPTV` (minutes).

### Streaming (`src/modules/streaming/index.ts`)

- `joinVoiceChannel(guildId, channelId)` returns a `boolean`. It leaves any
  existing connection, joins the requested channel, and **times out after 20s**
  so a stuck voice handshake cannot hang a slash command. Prefer this over
  checking connection state yourself.
- `startStreaming(channel)` builds an FFmpeg pipeline with `prepareStream`
  (H.264; libx264 or VAAPI per `ENCODER`) and plays it with `playStream` in
  `go-live` mode. `streaming/video.ts` builds the encoder; resolution/fps caps
  (`streaming/video-options.ts`, pure, imported by `config`) are injected as
  encoder `outFilters` so they run before VAAPI's `hwupload`. Caps use
  `min(ih,N)` / `min(source_fps,N)` so sources are never upscaled.
- `startStreaming` tries `buildPlaybackPlans()` in order (configured setup,
  then CPU decoding, then CPU encoding). An attempt that throws within 20s is
  "failed to start" and triggers the next plan; the working plan index is
  remembered per stream URL in memory. On failure the last FFmpeg stderr lines
  are logged (redacted).
- discord-video-stream's `minimizeLatency` emits an invalid `-flags lowdelay`;
  keep it `false` and pass `LOW_LATENCY_INPUT_OPTIONS` via `customInputOptions`.
  The returned FFmpeg promise is explicitly handled so it never becomes an
  unhandled rejection.
- Channel changes keep the Go Live session open (`SEAMLESS_SWITCHING`,
  default on): `streaming/session.ts#LiveSession` reimplements the part of the
  library's `playStream` that wires demuxed packets into the stream connection,
  but only `end()` stops the Go Live stream. The packetizer is only reset when
  the video codec changes, so RTP sequence numbers/timestamps continue across
  sources. `VideoStream`, `AudioStream` and `AVCodecID` are not exported by the
  library and are loaded from its `dist/media` files; if that fails (library
  layout changed) playback falls back to `playStream`.
- `stopPlayback()` stops the current source only; `stopStreaming()` also ends
  the Go Live session (used by `/stop`, idle timeout, leaving voice, and when a
  source ends or fails). `leaveVoiceChannel()` stops and disconnects.
- A spectator monitor stops the stream after `DEFAULT_STREAM_TIMEOUT` minutes
  with no non-bot viewers.

### Guide search (`/search`)

- `iptv/search.ts#searchProgrammes` is pure: accent/punctuation-insensitive,
  every query word must match the title/subtitle (ranked first) or description,
  finished programmes and unplayable channels are skipped, and all channels
  sharing an EPG id are returned per programme.
- `embeds/search.ts` renders results with Discord `<t:...>` timestamps (shown
  in each viewer's own time zone); `commands/search.ts` adds one watch button
  per result (custom IDs carry the result index to stay unique).

### Discord bot (`src/utils/discord.ts`)

- Registers guild slash commands on `ready` and dispatches interactions.
- Autocomplete always responds (even with an empty list) and caps choices at 25.
- Channel names are **not** unique (e.g. "AMC" in US, CA and EU categories).
  Identify channels with `utils/channels.ts#channelKey` (short hash of the
  stream URL, stable across refreshes) in autocomplete values and button custom
  IDs, and resolve user input with `findChannel` (key first, then name). Show
  `channelDisplayName` (name + category) where same-named channels may appear
  together. `findChannelBySanitizedId` also accepts keys, so old buttons with
  sanitized names keep working.

## Environment variables

See `.env.example` and the README table. Required: `DISCORD_BOT_TOKEN`,
`DISCORD_USER_TOKEN`, `GUILD`, plus either `PLAYLIST` or all of `XTREAM_HOST`,
`XTREAM_USERNAME`, `XTREAM_PASSWORD`. Optional: `XMLTV`, `XTREAM_OUTPUT`,
`XTREAM_CATEGORIES`, `XTREAM_EPG`, `XMLTV_DAYS`,
`REFRESH_IPTV`, `RAM_CACHE`, `CACHE_DIR`, `DEBUG`, `DEFAULT_STREAM_TIMEOUT`,
`TZ`, `MINIMIZE_LATENCY`, `BITRATE_VIDEO`, `BITRATE_VIDEO_MAX`,
`DISABLE_TRANSCODE`, `ENCODER`, `VAAPI_DEVICE`, `HARDWARE_DECODING`,
`STREAM_RESOLUTION`, `STREAM_FPS`.

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
- `.github/workflows/ci.yml` runs typecheck and tests on pull requests, and is
  reused (`workflow_call`) by the release workflow.
- `.github/workflows/release.yml` runs on every push to `master`: tests, then
  builds the image and pushes it to `ghcr.io/<owner>/<repo>` (`latest`,
  `sha-<commit>`). If `package.json`'s `version` has no matching git tag yet,
  it also tags the image with the version and creates a GitHub release (tag =
  bare version, e.g. `1.4.0`) with the source package attached. Bump the
  version to release.
