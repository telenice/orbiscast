/**
 * Pure helpers for video output options. Kept free of the streaming library so
 * configuration can import them without loading native modules.
 */

export type EncoderType = 'software' | 'vaapi';

/**
 * Parses a resolution cap such as `1080`, `1080p` or `720P`.
 *
 * @param value - Raw value
 * @returns Maximum output height in pixels, or 0 when unset or invalid (keep native)
 */
export function parseResolution(value: string | undefined): number {
    const match = (value || '').trim().match(/^(\d+)\s*p?$/i);
    const height = match ? parseInt(match[1] ?? '0', 10) : 0;
    return Number.isFinite(height) && height > 0 ? height : 0;
}

/**
 * Parses a frame rate cap such as `30` or `29.97`.
 *
 * @param value - Raw value
 * @returns Maximum frame rate, or 0 when unset or invalid (keep native)
 */
export function parseFrameRate(value: string | undefined): number {
    const fps = parseFloat((value || '').trim());
    return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

/**
 * Builds FFmpeg video filters that cap resolution and frame rate. Sources that
 * are already at or below a cap are left untouched (never upscaled, never
 * given extra frames). A cap of 0 means "keep the source value".
 *
 * @param maxHeight - Maximum output height in pixels (0 = native)
 * @param maxFps - Maximum output frame rate (0 = native)
 * @returns Filters to run before the encoder
 */
export function buildCapFilters(maxHeight: number, maxFps: number): string[] {
    const filters: string[] = [];
    if (maxHeight > 0) {
        // -2 keeps the aspect ratio with an even width; min() prevents upscaling.
        filters.push(`scale=-2:'min(ih,${Math.floor(maxHeight)})'`);
    }
    if (maxFps > 0) {
        filters.push(`fps='min(source_fps,${maxFps})'`);
    }
    return filters;
}

/**
 * Filters FFmpeg's verbose output down to lines that help explain a failure
 * (skipping the version banner, build configuration and progress noise).
 *
 * @param line - One line of FFmpeg stderr
 * @returns True if the line is worth keeping
 */
export function isUsefulFfmpegLine(line: string): boolean {
    const text = line.trim();
    if (!text) return false;
    return !/^(ffmpeg version|built with|configuration:|lib(avutil|avcodec|avformat|avdevice|avfilter|swscale|swresample|postproc)\b)/.test(text);
}

/**
 * How one playback attempt decodes and encodes the video.
 */
export interface PlaybackPlan {
    hardwareDecoding: boolean;
    encoder: EncoderType;
}

/**
 * Builds the ordered list of playback attempts for a stream. The configured
 * setup comes first; if it fails to start, GPU decoding is dropped, then (for
 * VAAPI) GPU encoding, so a channel the GPU can't handle still plays on the CPU.
 * Passthrough streams have nothing to fall back to.
 *
 * @param options - Configured transcoding, encoder and hardware decoding
 * @returns Attempts in order, without duplicates
 */
export function buildPlaybackPlans(options: { transcoding: boolean; encoder: EncoderType; hardwareDecoding: boolean }): PlaybackPlan[] {
    if (!options.transcoding) {
        return [{ hardwareDecoding: false, encoder: options.encoder }];
    }
    const plans: PlaybackPlan[] = [{ hardwareDecoding: options.hardwareDecoding, encoder: options.encoder }];
    if (options.hardwareDecoding) {
        plans.push({ hardwareDecoding: false, encoder: options.encoder });
    }
    if (options.encoder !== 'software') {
        plans.push({ hardwareDecoding: false, encoder: 'software' });
    }
    return plans;
}

/**
 * Describes a playback plan for logs, e.g. "GPU decoding + vaapi encoding".
 */
export function describePlaybackPlan(plan: PlaybackPlan): string {
    const encoding = plan.encoder === 'software' ? 'CPU encoding' : `GPU (${plan.encoder}) encoding`;
    return `${plan.hardwareDecoding ? 'GPU' : 'CPU'} decoding + ${encoding}`;
}
