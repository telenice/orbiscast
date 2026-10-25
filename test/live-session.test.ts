import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';

let nextCodec = 27; // H264
vi.mock('@dank074/discord-video-stream', async (original) => ({
    ...(await original<typeof import('@dank074/discord-video-stream')>()),
    demux: vi.fn(async () => ({
        video: { codec: nextCodec, width: 1280, height: 720, framerate_num: 25, framerate_den: 1, stream: new PassThrough({ objectMode: true }) },
        audio: { stream: new PassThrough({ objectMode: true }) },
    })),
}));

import { LiveSession } from '../src/modules/streaming/session';

function fakeStreamer() {
    const calls = { createStream: 0, stopStream: 0, setPacketizer: [] as string[], videoAttributes: [] as any[] };
    const streamer: any = {
        voiceConnection: { streamConnection: undefined as any },
        createStream: async () => {
            calls.createStream++;
            const conn = {
                setPacketizer: (codec: string) => calls.setPacketizer.push(codec),
                mediaConnection: {
                    setSpeaking: () => { },
                    setVideoAttributes: (enabled: boolean, attrs?: any) => calls.videoAttributes.push(enabled ? attrs : false),
                },
            };
            streamer.voiceConnection.streamConnection = conn;
            return conn;
        },
        stopStream: () => {
            calls.stopStream++;
            streamer.voiceConnection.streamConnection = undefined;
        },
    };
    return { streamer, calls };
}

/** Starts a source and switches away from it, like changing channel. */
async function playAndSwitch(session: LiveSession) {
    const controller = new AbortController();
    const playing = session.play(new PassThrough(), controller.signal);
    await new Promise(r => setTimeout(r, 20));
    controller.abort(new Error('switched'));
    await expect(playing).rejects.toThrow('switched');
}

describe('LiveSession', () => {
    it('keeps one Go Live stream across channel switches', async () => {
        const { streamer, calls } = fakeStreamer();
        const session = new LiveSession(streamer);

        await playAndSwitch(session);
        await playAndSwitch(session);
        await playAndSwitch(session);

        expect(calls.createStream).toBe(1);
        expect(calls.stopStream).toBe(0);
        expect(session.active).toBe(true);
        // Same codec: the packetizer (RTP sequence/timestamps) is never reset.
        expect(calls.setPacketizer).toEqual(['H264']);
        expect(calls.videoAttributes).toHaveLength(3);
    });

    it('only resets the packetizer when the codec changes', async () => {
        const { streamer, calls } = fakeStreamer();
        const session = new LiveSession(streamer);
        nextCodec = 27;
        await playAndSwitch(session);
        nextCodec = 173; // HEVC passthrough channel
        await playAndSwitch(session);
        nextCodec = 27;
        expect(calls.setPacketizer).toEqual(['H264', 'H265']);
    });

    it('ends the Go Live stream on end()', async () => {
        const { streamer, calls } = fakeStreamer();
        const session = new LiveSession(streamer);
        await playAndSwitch(session);
        session.end();
        expect(calls.stopStream).toBe(1);
        expect(session.active).toBe(false);
        expect(calls.videoAttributes.at(-1)).toBe(false);
        session.end();
        expect(calls.stopStream).toBe(1);
    });

    it('starts a new Go Live stream if the old one went away (e.g. voice channel changed)', async () => {
        const { streamer, calls } = fakeStreamer();
        const session = new LiveSession(streamer);
        await playAndSwitch(session);
        streamer.voiceConnection = { streamConnection: undefined };
        await playAndSwitch(session);
        expect(calls.createStream).toBe(2);
    });

    it('resolves when the source ends by itself', async () => {
        const { streamer } = fakeStreamer();
        const demuxed = new PassThrough({ objectMode: true });
        const { demux } = await import('@dank074/discord-video-stream');
        vi.mocked(demux).mockResolvedValueOnce({
            video: { codec: 27, width: 1280, height: 720, framerate_num: 25, framerate_den: 1, stream: demuxed } as any,
            audio: undefined,
        });
        const session = new LiveSession(streamer);
        const playing = session.play(new PassThrough(), new AbortController().signal);
        await new Promise(r => setTimeout(r, 20));
        demuxed.end();
        await expect(playing).resolves.toBeUndefined();
    });
});
