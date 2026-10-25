import { Encoders } from '@dank074/discord-video-stream';
import type { EncoderType } from './video-options';

export { buildCapFilters, parseFrameRate, parseResolution } from './video-options';
export type { EncoderType } from './video-options';

/**
 * An encoder factory as accepted by discord-video-stream's `prepareStream`.
 */
export type EncoderFactory = ReturnType<typeof Encoders.software>;

/**
 * Creates the encoder factory for the configured encoder.
 *
 * @param type - `software` (libx264 on the CPU) or `vaapi` (Intel/AMD GPU)
 * @param vaapiDevice - DRM render node for VAAPI
 * @returns Encoder factory
 */
export function createEncoder(type: EncoderType, vaapiDevice: string): EncoderFactory {
    if (type === 'vaapi') {
        return Encoders.vaapi({ device: vaapiDevice }) as EncoderFactory;
    }
    return Encoders.software({
        x264: { preset: 'veryfast' },
        x265: { preset: 'veryfast' },
    });
}

/**
 * Wraps an encoder factory so the given filters run before the encoder's own
 * filters (which, for VAAPI, upload frames to the GPU and must stay last).
 *
 * @param encoder - Encoder factory to wrap
 * @param filters - Filters to prepend
 * @returns Wrapped encoder factory (the original when there are no filters)
 */
export function withVideoFilters(encoder: EncoderFactory, filters: string[]): EncoderFactory {
    if (filters.length === 0) {
        return encoder;
    }
    return ((bitrate: number, bitrateMax: number) => {
        const settings = encoder(bitrate, bitrateMax) as Record<string, any>;
        const wrapped: Record<string, any> = {};
        for (const [codec, value] of Object.entries(settings)) {
            wrapped[codec] = value
                ? { ...value, outFilters: [...filters, ...(value.outFilters ?? [])] }
                : value;
        }
        return wrapped;
    }) as EncoderFactory;
}
