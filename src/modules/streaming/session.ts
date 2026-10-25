import { createRequire } from 'module';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import type { Readable } from 'stream';
import { demux } from '@dank074/discord-video-stream';
import type { Streamer } from '@dank074/discord-video-stream';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

/**
 * Pieces of discord-video-stream that its public API doesn't export. They are
 * loaded from the package's files so a Go Live session can outlive one source.
 */
interface StreamInternals {
    VideoStream: new (conn: any) => NodeJS.WritableStream & { syncStream?: unknown; destroy(): void; once(event: string, cb: (...args: any[]) => void): any };
    AudioStream: new (conn: any) => NodeJS.WritableStream & { destroy(): void };
    codecName: (codecId: number) => string | undefined;
}

let internalsPromise: Promise<StreamInternals> | null = null;

/**
 * Loads the library internals needed for seamless switching.
 * Rejects if the library layout changed (callers fall back to playStream).
 */
export function loadStreamInternals(): Promise<StreamInternals> {
    internalsPromise ??= (async () => {
        const entry = createRequire(__filename).resolve('@dank074/discord-video-stream');
        const mediaDir = join(dirname(entry), 'media');
        const load = (file: string) => import(pathToFileURL(join(mediaDir, file)).href);
        const [video, audio, ids] = await Promise.all([
            load('VideoStream.js'),
            load('AudioStream.js'),
            load('LibavCodecId.js'),
        ]);
        if (typeof video.VideoStream !== 'function' || typeof audio.AudioStream !== 'function' || !ids.AVCodecID) {
            throw new Error('discord-video-stream internals not found');
        }
        const { AVCodecID } = ids;
        const names: Record<number, string> = {
            [AVCodecID.AV_CODEC_ID_H264]: 'H264',
            [AVCodecID.AV_CODEC_ID_H265]: 'H265',
            [AVCodecID.AV_CODEC_ID_VP8]: 'VP8',
            [AVCodecID.AV_CODEC_ID_VP9]: 'VP9',
            [AVCodecID.AV_CODEC_ID_AV1]: 'AV1',
        };
        return {
            VideoStream: video.VideoStream,
            AudioStream: audio.AudioStream,
            codecName: (codecId: number) => names[codecId],
        };
    })();
    internalsPromise.catch(() => { internalsPromise = null; });
    return internalsPromise;
}

/**
 * A Go Live session that stays open while sources change, so switching
 * channels doesn't end the stream for viewers. It mirrors what
 * discord-video-stream's `playStream` does, except the stream is only torn
 * down by {@link LiveSession.end}, not when a source stops.
 */
export class LiveSession {
    private conn: any = null;
    private codec: string | null = null;

    constructor(private readonly streamer: Streamer) { }

    /** True while the Go Live stream this session created is still the active one. */
    get active(): boolean {
        return this.conn !== null && this.streamer.voiceConnection?.streamConnection === this.conn;
    }

    /**
     * Plays one source (FFmpeg's NUT output) into the session, creating the Go
     * Live stream if needed. Resolves when the source ends; rejects with the
     * abort reason when `signal` is aborted (the session stays open).
     *
     * @param input - FFmpeg output stream
     * @param signal - Aborted to stop this source
     */
    async play(input: Readable, signal: AbortSignal): Promise<void> {
        const internals = await loadStreamInternals();
        signal.throwIfAborted();

        const { video, audio } = await demux(input, { format: 'nut' });
        signal.throwIfAborted();
        if (!video) {
            throw new Error('No video stream in media');
        }

        const codec = internals.codecName(video.codec);
        if (!codec) {
            throw new Error(`Unsupported video codec id ${video.codec}`);
        }

        if (!this.active) {
            logger.debug('Starting a new Go Live session');
            this.conn = await this.streamer.createStream();
            this.codec = null;
            signal.throwIfAborted();
        }

        const conn = this.conn;
        // Keep the existing packetizer when the codec is unchanged, so RTP
        // sequence numbers and timestamps continue and viewers see no restart.
        if (codec !== this.codec) {
            conn.setPacketizer(codec);
            this.codec = codec;
        }
        conn.mediaConnection.setSpeaking(true);
        conn.mediaConnection.setVideoAttributes(true, {
            width: Math.round(video.width),
            height: Math.round(video.height),
            fps: Math.round(video.framerate_num / video.framerate_den) || 30,
        });

        const vStream = new internals.VideoStream(conn);
        video.stream.pipe(vStream as any);
        let aStream: InstanceType<StreamInternals['AudioStream']> | undefined;
        if (audio) {
            aStream = new internals.AudioStream(conn);
            audio.stream.pipe(aStream as any);
            vStream.syncStream = aStream;
        }

        return new Promise<void>((resolve, reject) => {
            const detach = () => {
                // Stop feeding this source into the session but keep the session.
                video.stream.unpipe(vStream as any);
                video.stream.resume();
                if (audio && aStream) {
                    audio.stream.unpipe(aStream as any);
                    audio.stream.resume();
                }
                vStream.destroy();
                aStream?.destroy();
            };
            signal.addEventListener('abort', () => {
                detach();
                reject(signal.reason);
            }, { once: true });
            vStream.once('finish', () => {
                if (!signal.aborted) resolve();
            });
            vStream.once('error', (err: unknown) => {
                if (signal.aborted) return;
                detach();
                reject(err);
            });
        });
    }

    /** Ends the Go Live stream for everyone. Safe to call when nothing is live. */
    end(): void {
        if (this.active) {
            try {
                this.conn.mediaConnection.setSpeaking(false);
                this.conn.mediaConnection.setVideoAttributes(false);
            } catch (error) {
                logger.debug(`Error resetting stream attributes: ${error}`);
            }
            this.streamer.stopStream();
            logger.debug('Ended the Go Live session');
        }
        this.conn = null;
        this.codec = null;
    }
}
