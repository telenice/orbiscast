import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: Array<{ hw: boolean; encoder: string }> = [];
let failWhen: (opts: any) => boolean = () => false;

vi.mock('@lng2004/discord.js-selfbot-v13', () => ({ Client: class {} }));
vi.mock('@dank074/discord-video-stream', () => {
    const encoderFor = (name: string) => () => () => ({ H264: { name, options: [] } });
    return {
        Streamer: class { client = { isReady: () => true }; },
        Utils: { normalizeVideoCodec: (c: string) => c },
        Encoders: { software: encoderFor('libx264'), vaapi: encoderFor('h264_vaapi') },
        prepareStream: (_url: string, opts: any) => {
            const encoderName = opts.encoder(5000, 7500).H264.name;
            calls.push({ hw: Boolean(opts.hardwareAcceleratedDecoding), encoder: encoderName });
            const command = new EventEmitter();
            const fails = failWhen({ hw: opts.hardwareAcceleratedDecoding, encoder: encoderName });
            if (fails) setTimeout(() => command.emit('stderr', '[hevc] Error while decoding with the GPU'), 5);
            return { command, output: new PassThrough(), promise: Promise.resolve(), fails };
        },
        playStream: async () => {
            const last = calls[calls.length - 1]!;
            if (failWhen(last)) {
                await new Promise(r => setTimeout(r, 20));
                throw new Error('Failed to open input from Readable stream: Invalid data found when processing input');
            }
        },
    };
});

async function loadStreaming() {
    vi.resetModules();
    process.env.ENCODER = 'vaapi';
    process.env.VAAPI_DEVICE = '/';
    process.env.DISABLE_TRANSCODE = 'false';
    delete process.env.HARDWARE_DECODING;
    return import('../src/modules/streaming/index.js');
}

const channel = { xui_id: 1, tvg_name: 'The Vampire Diaries', tvg_id: 'tvd', url: 'http://x/live/u/p/1718616.ts' };

describe('startStreaming GPU fallback', () => {
    beforeEach(() => { calls.length = 0; });

    it('retries with CPU decoding when GPU decoding fails, and remembers it', async () => {
        failWhen = c => c.hw;
        const streaming = await loadStreaming();
        await streaming.startStreaming(channel);
        expect(calls).toEqual([
            { hw: true, encoder: 'h264_vaapi' },
            { hw: false, encoder: 'h264_vaapi' },
        ]);

        calls.length = 0;
        await streaming.startStreaming(channel);
        expect(calls).toEqual([{ hw: false, encoder: 'h264_vaapi' }]);
    }, 20_000);

    it('falls back to CPU encoding when the GPU encoder fails too', async () => {
        failWhen = c => c.encoder === 'h264_vaapi';
        const streaming = await loadStreaming();
        await streaming.startStreaming(channel);
        expect(calls.map(c => `${c.hw}/${c.encoder}`)).toEqual(['true/h264_vaapi', 'false/h264_vaapi', 'false/libx264']);
    }, 20_000);

    it('does not retry when the stream works', async () => {
        failWhen = () => false;
        const streaming = await loadStreaming();
        await streaming.startStreaming(channel);
        expect(calls).toEqual([{ hw: true, encoder: 'h264_vaapi' }]);
    }, 20_000);

    it('gives up after the last option', async () => {
        failWhen = () => true;
        const streaming = await loadStreaming();
        await streaming.startStreaming(channel);
        expect(calls).toHaveLength(3);
    }, 20_000);
});
