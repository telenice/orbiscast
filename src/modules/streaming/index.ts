import { Client } from '@lng2004/discord.js-selfbot-v13';
import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { redactUrl } from '../../utils/redact';
import { existsSync } from 'fs';
import { buildCapFilters, createEncoder, withVideoFilters } from './video';
import { buildPlaybackPlans, buildToneMapFilters, describePlaybackPlan, isHdrStreamLine, isUsefulFfmpegLine } from './video-options';
import type { PlaybackPlan } from './video-options';
import type { EncoderType } from './video';
import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import type { ChannelEntry } from '../../interfaces/iptv';

const FFMPEG_LOG_LINES = 25;

let vaapiFallbackLogged = false;

/**
 * Returns the encoder to use, falling back to software when the configured
 * VAAPI device is not available (e.g. /dev/dri not passed to the container).
 */
function activeEncoder(): EncoderType {
    if (config.ENCODER === 'vaapi' && !existsSync(config.VAAPI_DEVICE)) {
        if (!vaapiFallbackLogged) {
            logger.error(`VAAPI device ${config.VAAPI_DEVICE} not found; falling back to software encoding. Pass /dev/dri to the container.`);
            vaapiFallbackLogged = true;
        }
        return 'software';
    }
    return config.ENCODER;
}

/**
 * Low-latency FFmpeg input options (replacement for the library's minimizeLatency).
 */
export const LOW_LATENCY_INPUT_OPTIONS = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-flush_packets', '1', '-max_delay', '100000'];

const logger = getLogger();
const streamer = new Streamer(new Client());
let abortController = new AbortController();
let currentChannelEntry: ChannelEntry | null = null;
let streamSpectatorMonitor: ReturnType<typeof setInterval> | null = null;
let streamAloneTime = 0;

/**
 * How long to wait for the Discord voice handshake before giving up.
 * Without this, a stuck handshake (e.g. a voice gateway that never sends
 * READY) leaves the slash command hanging on "orbiscast is thinking..." forever.
 */
const JOIN_VOICE_TIMEOUT_MS = 20_000;

/**
 * Rejects if the provided promise does not settle within the timeout.
 *
 * @param promise - Promise to wait for
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @param message - Error message used when the timeout is reached
 * @returns The resolved value of the wrapped promise
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            error => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}

/**
 * Initializes the streaming client
 * Logs in the streamer client for video streaming capabilities
 */
export async function initializeStreamer() {
    try {
        await loginStreamer();
    } catch (error) {
        logger.error(`Error logging in streamer client: ${error}`);
    }
}

/**
 * Disconnects the streamer client without invalidating the user token.
 *
 * `Client#logout()` calls Discord's logout endpoint, which revokes the user
 * token and forces the account to log in again. `Client#destroy()` only closes
 * the gateway connection, which is what we want on shutdown.
 */
export async function shutdownStreamer() {
    if (!streamer.client.isReady()) {
        logger.debug('Streamer client is not logged in');
        return;
    }

    try {
        if (streamer.voiceConnection) {
            streamer.leaveVoice();
        }
        streamer.client.destroy();
        logger.info('Streamer client disconnected');
    } catch (error) {
        logger.error(`Error disconnecting streamer client: ${error}`);
    }
}

/**
 * Logs in the streamer client using the user token
 */
async function loginStreamer() {
    if (streamer.client.isReady()) {
        logger.debug('Streamer client is already logged in');
        return;
    }
    await (streamer.client as Client).login(config.DISCORD_USER_TOKEN);
    logger.info('Streamer client logged in successfully');
}

/**
 * Gets the current streaming channel entry.
 *
 * @returns Channel entry object or null if not streaming
 */
export function getCurrentChannelEntry(): ChannelEntry | null {
    return currentChannelEntry;
}

/**
 * Joins a voice channel in the specified guild.
 *
 * Handles switching between channels and never waits forever on a stuck
 * handshake.
 *
 * @param guildId - Discord guild ID
 * @param channelId - Voice channel ID to join
 * @returns True when the streamer is connected to the requested channel
 */
export async function joinVoiceChannel(guildId: string, channelId: string): Promise<boolean> {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in.');
        return false;
    }

    const guild = streamer.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);

    if (!guild || !channel || !channel.isVoice()) {
        logger.error('Invalid guild or channel ID.');
        return false;
    }

    const connection = streamer.voiceConnection;
    if (connection && connection.channelId === channelId) {
        logger.debug(`Already connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        return true;
    }

    // Leave any existing connection first so the voice gateway does not mix
    // up session/token updates between the old and the new channel.
    if (connection) {
        logger.debug(`Switching voice channel, leaving ${connection.channelId} first`);
        streamer.leaveVoice();
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    try {
        const conn = await withTimeout(
            streamer.joinVoice(guildId, channelId),
            JOIN_VOICE_TIMEOUT_MS,
            `Timed out joining voice channel: ${channel.name} in guild: ${guild.name}`
        );

        // `joinVoice` resolves once the media connection is ready. The `ready`
        // getter reflects the WebRTC state, which may still be settling, so a
        // resolved connection is treated as success regardless.
        if (conn.ready) {
            logger.info(`Connected to voice channel: ${channel.name} in guild: ${guild.name}`);
        } else {
            logger.info(`Connected to voice channel: ${channel.name} in guild: ${guild.name}`);
            logger.debug('WebRTC connection is still settling after the voice join');
        }

        return true;
    } catch (error) {
        logger.error(`Error joining voice channel: ${error}`);
        // Make sure no half-open connection is left behind.
        streamer.leaveVoice();
        return false;
    }
}

/**
 * Stops the stream and leaves the current voice channel
 */
export async function leaveVoiceChannel() {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return;
    }
    try {
        if (currentChannelEntry) {
            await stopStreaming();
        }
        const guildId = streamer.voiceConnection?.guildId;
        const channelId = streamer.voiceConnection?.channelId;
        const guild = guildId ? streamer.client.guilds.cache.get(guildId) : undefined;
        const channel = guild && channelId ? guild.channels.cache.get(channelId) : undefined;
        streamer.leaveVoice();
        logger.info(`Stopped video stream and disconnected from the voice channel: ${channel?.name || 'unknown'} in guild: ${guild?.name || 'unknown'}`);
    } catch (error) {
        logger.error(`Error leaving voice channel: ${error}`);
    }
}

/**
 * Starts monitoring spectators in the voice channel.
 * Automatically stops the stream if there are no viewers for a specified time.
 *
 * @returns Cleanup function to stop monitoring
 */
function startSpectatorMonitoring(): () => void {
    streamAloneTime = 0;

    if (streamSpectatorMonitor) {
        clearInterval(streamSpectatorMonitor);
        streamSpectatorMonitor = null;
    }

    logger.debug('Starting spectator monitoring');

    streamSpectatorMonitor = setInterval(() => {
        try {
            const channelId = streamer.voiceConnection?.channelId;
            if (!channelId) {
                logger.debug('No active voice connection found during monitoring');
                return;
            }

            const channel = streamer.client.channels.cache.get(channelId);
            if (!channel || !channel.isVoice()) {
                logger.debug('Could not retrieve valid voice channel during monitoring');
                return;
            }

            // we don't count bots as spectators, and we don't count the bot itself
            const members = channel.members.filter(member => !member.user.bot).size - 1;
            if (members === 0) {
                streamAloneTime += 10;
                logger.debug(`No spectators for ${streamAloneTime} seconds`);

                if (streamAloneTime >= config.DEFAULT_STREAM_TIMEOUT * 60) {
                    logger.info(`No spectators for ${config.DEFAULT_STREAM_TIMEOUT} ${config.DEFAULT_STREAM_TIMEOUT > 1 ? 'minutes' : 'minute'}. Stopping stream.`);

                    stopStreaming().then(() => {
                        return leaveVoiceChannel();
                    }).catch(err => {
                        logger.error(`Error during automated stream cleanup: ${err}`);
                    });
                }
            } else {
                streamAloneTime = 0;
            }
        } catch (error) {
            logger.error(`Error in spectator monitoring: ${error}`);
        }
    }, 10000);

    return () => {
        if (streamSpectatorMonitor) {
            logger.debug('Cleaning up spectator monitor');
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;
    };
}

/**
 * Channels (by stream URL) that only started after falling back, mapped to the
 * playback plan that worked, so later plays skip the failing GPU setup.
 */
const workingPlanByUrl = new Map<string, number>();

/** A stream that fails within this window is treated as "failed to start". */
const START_FAILURE_WINDOW_MS = 20_000;

type PlayOutcome = 'finished' | 'stopped' | 'failed-to-start' | 'failed' | 'restart';

/** Channels (by stream URL) detected as HDR, which get tone mapping. */
const hdrUrls = new Set<string>();
let hdrPassthroughHintLogged = false;

/**
 * Starts streaming a channel to the voice channel the streamer is in. If the
 * configured GPU setup can't handle a channel (it fails to start), playback is
 * retried with CPU decoding, then CPU encoding, and the working setup is
 * remembered for that channel.
 *
 * @param channelEntry - Channel to stream
 */
export async function startStreaming(channelEntry: ChannelEntry) {
    if (!streamer.client.isReady()) {
        logger.error('Streamer client is not logged in');
        return;
    }

    const plans = buildPlaybackPlans({
        transcoding: !config.DISABLE_TRANSCODE,
        encoder: config.ENCODER,
        hardwareDecoding: config.HARDWARE_DECODING,
    });
    const first = Math.min(workingPlanByUrl.get(channelEntry.url) ?? 0, plans.length - 1);
    if (first > 0) {
        logger.info(`Using ${describePlaybackPlan(plans[first]!)} for ${channelEntry.tvg_name} (it failed with the GPU before)`);
    }

    for (let index = first; index < plans.length; index++) {
        const plan = plans[index]!;
        const outcome = await playOnce(channelEntry, plan, plans.length > 1);

        if (outcome === 'restart') {
            index--; // retry the same setup, now with HDR tone mapping
            continue;
        }
        if (outcome === 'failed-to-start' && index < plans.length - 1) {
            logger.warn(`${channelEntry.tvg_name} failed to start with ${describePlaybackPlan(plan)}; retrying with ${describePlaybackPlan(plans[index + 1]!)}`);
            continue;
        }
        if (outcome !== 'failed-to-start' && outcome !== 'stopped' && index > 0) {
            workingPlanByUrl.set(channelEntry.url, index);
        }
        if (outcome === 'failed-to-start' || outcome === 'failed') {
            await stopStreaming();
        }
        return;
    }
}

/**
 * Runs a single playback attempt until the stream ends, is stopped, or fails.
 *
 * @param channelEntry - Channel to stream
 * @param plan - How to decode and encode
 * @param logPlan - Whether to mention the plan in the log
 * @returns How the attempt ended
 */
async function playOnce(channelEntry: ChannelEntry, plan: PlaybackPlan, logPlan: boolean): Promise<PlayOutcome> {
    let signal = abortController.signal;
    const ffmpegLog: string[] = [];
    const startedAt = Date.now();
    let restartForHdr = false;

    try {
        logger.info(`Stopping any possible existing stream.`);
        await stopStreaming();

        // Capture the signal for this playback run. `stopStreaming` swaps in a
        // fresh controller, so checking the module-level one later could race.
        signal = abortController.signal;

        const planNote = logPlan && !config.DISABLE_TRANSCODE ? ` with ${describePlaybackPlan(plan)}` : '';
        logger.info(`Attempting to stream: ${channelEntry.tvg_name} (${redactUrl(channelEntry.url)})${planNote}`);

        const toneMapping = !config.DISABLE_TRANSCODE && config.HDR_TONEMAP !== 'off' ? config.HDR_TONEMAP : null;
        const encoder = withVideoFilters(
            createEncoder(plan.encoder === 'software' ? 'software' : activeEncoder(), config.VAAPI_DEVICE),
            [
                ...buildCapFilters(config.STREAM_RESOLUTION, config.STREAM_FPS),
                ...(toneMapping && hdrUrls.has(channelEntry.url) ? buildToneMapFilters(toneMapping) : []),
            ]
        );
        if (toneMapping && hdrUrls.has(channelEntry.url)) {
            logger.info(`Tone mapping HDR to SDR (${toneMapping}) for ${channelEntry.tvg_name}`);
        }

        const { command, output, promise } = prepareStream(channelEntry.url, {
            noTranscoding: config.DISABLE_TRANSCODE,
            // discord-video-stream's minimizeLatency passes `-flags lowdelay`, which
            // FFmpeg rejects (the constant is `low_delay`) and the stream fails to
            // start. Apply the same low-latency input options ourselves instead.
            minimizeLatency: false,
            customInputOptions: config.MINIMIZE_LATENCY ? LOW_LATENCY_INPUT_OPTIONS : [],
            bitrateVideo: config.BITRATE_VIDEO,
            bitrateVideoMax: config.BITRATE_VIDEO_MAX,
            videoCodec: Utils.normalizeVideoCodec('H264'),
            encoder,
            hardwareAcceleratedDecoding: !config.DISABLE_TRANSCODE && plan.hardwareDecoding,
        }, signal);

        currentChannelEntry = channelEntry;

        // Keep FFmpeg's recent output: when a stream fails, the player usually
        // notices first and cancels FFmpeg, which would otherwise hide the real cause.
        command.on('stderr', (line: string) => {
            if (!hdrUrls.has(channelEntry.url) && isHdrStreamLine(line)) {
                if (toneMapping) {
                    // HDR shows washed out unless tone mapped. The filters are set when
                    // FFmpeg starts, so restart this channel once with them added.
                    hdrUrls.add(channelEntry.url);
                    restartForHdr = true;
                    logger.info(`${channelEntry.tvg_name} is HDR; restarting it with tone mapping`);
                    if (abortController.signal === signal) abortController.abort();
                } else if (config.DISABLE_TRANSCODE && !hdrPassthroughHintLogged) {
                    hdrPassthroughHintLogged = true;
                    logger.warn(`${channelEntry.tvg_name} is HDR and will look washed out; set DISABLE_TRANSCODE=false to tone map HDR channels`);
                }
            }
            if (isUsefulFfmpegLine(line)) {
                ffmpegLog.push(line);
                if (ffmpegLog.length > FFMPEG_LOG_LINES) ffmpegLog.shift();
            }
        });

        // The FFmpeg promise rejects when the process is cancelled or exits
        // with an error. Handle it here so it never becomes an unhandled
        // rejection; actual playback is driven by `playStream` below.
        promise.catch((err: unknown) => {
            if (!signal.aborted) {
                logger.warn(`FFmpeg exited: ${redactUrl(String(err)).split("\n")[0]}`);
            }
        });

        command.on('end', () => {
            logger.debug('FFmpeg process ended');
        });

        logger.info(`Streaming channel: ${channelEntry.tvg_name}.`);

        const cleanupMonitoring = startSpectatorMonitoring();

        try {
            await playStream(output, streamer, {
                type: 'go-live',
            }, signal);
        } finally {
            // Always cleanup monitoring regardless of success or failure
            cleanupMonitoring();
        }
        if (restartForHdr) return 'restart';
        return signal.aborted ? 'stopped' : 'finished';
    } catch (error) {
        // A cancelled stream is expected during stop; the caller is already
        // cleaning up, so only log/handle genuine failures.
        if (signal.aborted) {
            return restartForHdr ? 'restart' : 'stopped';
        }
        logger.error(`Error starting stream: ${redactUrl(String(error))}`);
        if (ffmpegLog.length > 0) {
            logger.error(`Last FFmpeg output:\n${ffmpegLog.map(line => redactUrl(line)).join('\n')}`);
        }
        return Date.now() - startedAt < START_FAILURE_WINDOW_MS ? 'failed-to-start' : 'failed';
    }
}

/**
 * Stops the current stream and cleans up resources
 */
export async function stopStreaming() {
    try {
        abortController.abort();
        await new Promise(resolve => setTimeout(resolve, 1000));
        abortController = new AbortController();

        if (streamSpectatorMonitor) {
            logger.debug('Clearing spectator monitor');
            clearInterval(streamSpectatorMonitor);
            streamSpectatorMonitor = null;
        }
        streamAloneTime = 0;

        if (!currentChannelEntry) {
            logger.debug('No channel currently playing');
            return;
        }

        logger.info(`Stopped video stream from ${currentChannelEntry?.tvg_name || 'unknown channel'}`);
        currentChannelEntry = null;
    } catch (error) {
        logger.error(`Error stopping stream: ${error}`);
    }
}
