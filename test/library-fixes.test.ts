import { createRequire } from 'module';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyLibraryFixes, signedExpGolombCodeNum } from '../src/modules/streaming/library-fixes';

const dist = dirname(createRequire(__filename).resolve('@dank074/discord-video-stream'));
const load = (file: string) => import(pathToFileURL(join(dist, file)).href);

describe('signedExpGolombCodeNum', () => {
    it('follows the H.264 mapping (0, 1, -1, 2, -2 -> 0, 1, 2, 3, 4)', () => {
        expect([0, 1, -1, 2, -2].map(signedExpGolombCodeNum)).toEqual([0, 1, 2, 3, 4]);
    });
});

describe('discord-video-stream fixes', () => {
    let lib: any;
    beforeAll(async () => {
        await applyLibraryFixes();
        lib = {
            ...(await load('client/processing/AnnexBBitstreamReaderWriter.js')),
            ...(await load('client/processing/SPSVUIRewriter.js')),
            ...(await load('client/voice/WebRtcWrapper.js')),
        };
    });

    it('writes signed zero and round-trips signed values', () => {
        const values = [0, 1, -1, 0, 5, -6, 127, -128, 0];
        const writer = new lib.AnnexBBitstreamWriter();
        for (const v of values) writer.writeSignedExpGolomb(v);
        writer.writeBits(1, 1);
        const reader = new lib.AnnexBBitstreamReader(writer.toBuffer());
        // The library's reader returns -0 for zero; normalise before comparing.
        expect(values.map(() => reader.readSignedExpGolomb() || 0)).toEqual(values);
    });

    it('rewrites an SPS whose signed fields are zero (the channel that crashed the bot)', () => {
        // Baseline-profile SPS with pic_order_cnt_type 1 and zero-valued offsets.
        const w = new lib.AnnexBBitstreamWriter();
        w.writeBits(66, 8);            // profile_idc (baseline)
        w.writeBits(0, 8);             // constraint flags
        w.writeBits(30, 8);            // level_idc
        w.writeUnsignedExpGolomb(0);   // seq_parameter_set_id
        w.writeUnsignedExpGolomb(0);   // log2_max_frame_num_minus4
        w.writeUnsignedExpGolomb(1);   // pic_order_cnt_type = 1
        w.writeBits(0, 1);             // delta_pic_order_always_zero_flag
        w.writeSignedExpGolomb(0);     // offset_for_non_ref_pic = 0
        w.writeSignedExpGolomb(0);     // offset_for_top_to_bottom_field = 0
        w.writeUnsignedExpGolomb(1);   // num_ref_frames_in_pic_order_cnt_cycle
        w.writeSignedExpGolomb(0);     // offset_for_ref_frame[0] = 0
        w.writeUnsignedExpGolomb(1);   // max_num_ref_frames
        w.writeBits(0, 1);             // gaps_in_frame_num_value_allowed_flag
        w.writeUnsignedExpGolomb(39);  // pic_width_in_mbs_minus1 (640)
        w.writeUnsignedExpGolomb(21);  // pic_height_in_map_units_minus1 (352)
        w.writeBits(1, 1);             // frame_mbs_only_flag
        w.writeBits(1, 1);             // direct_8x8_inference_flag
        w.writeBits(0, 1);             // frame_cropping_flag
        w.writeBits(0, 1);             // vui_parameters_present_flag
        w.writeBits(1, 1);             // rbsp_stop_one_bit
        const sps = Buffer.concat([Buffer.from([0x67]), w.toBuffer()]);

        const rewritten: Buffer = lib.rewriteSPSVUI(sps);
        expect(rewritten[0]).toBe(0x67);
        expect(rewritten.length).toBeGreaterThan(sps.length - 1);
    });

    it('contains errors while sending a video frame instead of crashing', () => {
        const send = lib.WebRtcConnWrapper.prototype.sendVideoFrame;
        expect(send.__orbiscastGuarded).toBe(true);
        const broken = { get ready() { throw new Error('boom'); } };
        expect(() => send.call(broken, Buffer.alloc(4), 40)).not.toThrow();
    });

    it('is safe to apply more than once', async () => {
        await applyLibraryFixes();
        expect(lib.WebRtcConnWrapper.prototype.sendVideoFrame.__orbiscastGuarded).toBe(true);
    });
});
