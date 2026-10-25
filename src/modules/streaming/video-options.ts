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
