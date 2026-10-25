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
    // Drop frames first so later (more expensive) filters process fewer of them.
    if (maxFps > 0) {
        filters.push(`fps='min(source_fps,${maxFps})'`);
    }
    if (maxHeight > 0) {
        // -2 keeps the aspect ratio with an even width; min() prevents upscaling.
        filters.push(`scale=-2:'min(ih,${Math.floor(maxHeight)})'`);
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

export type ToneMapping = 'mobius' | 'hable' | 'reinhard' | 'off';

/**
 * Parses the HDR tone-mapping setting.
 *
 * @param value - `mobius` (default), `hable`, `reinhard` or `off`
 * @returns The tone-mapping curve, or `off`
 */
export function parseToneMapping(value: string | undefined): ToneMapping {
    const v = (value || '').trim().toLowerCase();
    if (v === 'off' || v === 'false' || v === 'none') return 'off';
    if (v === 'hable' || v === 'reinhard' || v === 'mobius') return v;
    return 'mobius';
}

/**
 * True for an FFmpeg stream-info line describing HDR video: PQ (HDR10 /
 * `smpte2084`) or HLG (`arib-std-b67`), e.g.
 * `Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160`.
 *
 * @param line - One line of FFmpeg stderr
 */
export function isHdrStreamLine(line: string): boolean {
    return /Stream #\d+:\d+.*\bVideo:.*\b(smpte2084|arib-std-b67)\b/.test(line);
}

/**
 * Filters that convert HDR (PQ or HLG, BT.2020) to standard dynamic range
 * BT.709, so HDR channels don't look washed out in Discord. Requires FFmpeg
 * with zscale (libzimg). Only apply to HDR sources; SDR video would be altered.
 *
 * @param curve - Tone-mapping curve
 * @returns Filters to run before the encoder
 */
export function buildToneMapFilters(curve: Exclude<ToneMapping, 'off'>): string[] {
    return [
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        `tonemap=tonemap=${curve}:desat=0`,
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
    ];
}
