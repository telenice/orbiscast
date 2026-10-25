import { createRequire } from 'module';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { getLogger } from '../../utils/logger';

const logger = getLogger();

let fixesPromise: Promise<void> | null = null;

/**
 * Correct signed Exp-Golomb mapping (H.264 spec 9.1.1): se(v) = 0 -> 0,
 * positive v -> 2v - 1, negative v -> -2v.
 */
export function signedExpGolombCodeNum(value: number): number {
    return value > 0 ? 2 * value - 1 : 2 * Math.abs(value);
}

/**
 * Makes a failure while preparing a video frame (e.g. another bug in the
 * library's SPS rewriter) drop that frame and log it, instead of throwing out
 * of a stream callback and crashing the whole bot.
 */
async function guardVideoFrames(distDir: string): Promise<void> {
    const file = join(distDir, 'client', 'voice', 'WebRtcWrapper.js');
    const { WebRtcConnWrapper } = await import(pathToFileURL(file).href);
    const proto = WebRtcConnWrapper?.prototype;
    if (!proto || typeof proto.sendVideoFrame !== 'function' || proto.sendVideoFrame.__orbiscastGuarded) {
        return;
    }
    const original = proto.sendVideoFrame;
    let failures = 0;
    const guarded = function (this: unknown, ...args: unknown[]) {
        try {
            return original.apply(this, args);
        } catch (error) {
            failures++;
            if (failures === 1 || failures % 500 === 0) {
                logger.error(`Dropped a video frame the streaming library could not process (${failures} so far): ${error}`);
            }
        }
    };
    (guarded as any).__orbiscastGuarded = true;
    proto.sendVideoFrame = guarded;
}

/**
 * Patches bugs in @dank074/discord-video-stream at runtime.
 *
 * - `AnnexBBitstreamWriter.writeSignedExpGolomb` maps 0 to -1 and throws
 *   ("Expected a non-negative number"). It runs on every H.264 SPS the library
 *   rewrites, so any channel whose SPS has a signed field equal to 0 (e.g.
 *   scaling-list deltas or picture-order-count offsets) crashed the whole bot.
 *
 * - Errors while preparing a video frame are contained (see guardVideoFrames).
 *
 * The library's internal module is patched in place, so its own imports see
 * the fix. Safe to call repeatedly; failures are logged, never thrown.
 */
export function applyLibraryFixes(): Promise<void> {
    fixesPromise ??= (async () => {
        try {
            const entry = createRequire(__filename).resolve('@dank074/discord-video-stream');
            const file = join(dirname(entry), 'client', 'processing', 'AnnexBBitstreamReaderWriter.js');
            const { AnnexBBitstreamWriter } = await import(pathToFileURL(file).href);
            const proto = AnnexBBitstreamWriter?.prototype;
            if (!proto || typeof proto.writeSignedExpGolomb !== 'function' || typeof proto.writeUnsignedExpGolomb !== 'function') {
                logger.warn('discord-video-stream layout changed; signed Exp-Golomb fix not applied');
                return;
            }

            await guardVideoFrames(dirname(entry));

            // Only patch if the library still has the bug.
            let buggy = false;
            try {
                new AnnexBBitstreamWriter().writeSignedExpGolomb(0);
            } catch {
                buggy = true;
            }
            if (!buggy) {
                logger.debug('discord-video-stream already handles se(0); no patch needed');
                return;
            }

            proto.writeSignedExpGolomb = function (this: { writeUnsignedExpGolomb(n: number): void }, value: number) {
                this.writeUnsignedExpGolomb(signedExpGolombCodeNum(value));
            };
            logger.debug('Patched discord-video-stream signed Exp-Golomb writer');
        } catch (error) {
            logger.warn(`Could not apply discord-video-stream fixes: ${error}`);
        }
    })();
    return fixesPromise;
}
