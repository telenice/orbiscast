import { describe, expect, it } from 'vitest';
import { buildCapFilters, buildPlaybackPlans, buildToneMapFilters, describePlaybackPlan, isHdrStreamLine, isUsefulFfmpegLine, parseFrameRate, parseResolution, parseToneMapping } from '../src/modules/streaming/video-options';
import { createEncoder, withVideoFilters } from '../src/modules/streaming/video';

describe('parseResolution', () => {
    it('accepts plain numbers and a p suffix', () => {
        expect(parseResolution('1080')).toBe(1080);
        expect(parseResolution('720p')).toBe(720);
        expect(parseResolution(' 1440P ')).toBe(1440);
    });

    it('returns 0 (native) when unset or invalid', () => {
        expect(parseResolution(undefined)).toBe(0);
        expect(parseResolution('')).toBe(0);
        expect(parseResolution('0')).toBe(0);
        expect(parseResolution('4k')).toBe(0);
        expect(parseResolution('1920x1080')).toBe(0);
    });
});

describe('parseFrameRate', () => {
    it('accepts integers and decimals', () => {
        expect(parseFrameRate('30')).toBe(30);
        expect(parseFrameRate('29.97')).toBe(29.97);
    });

    it('returns 0 (native) when unset or invalid', () => {
        expect(parseFrameRate(undefined)).toBe(0);
        expect(parseFrameRate('-5')).toBe(0);
        expect(parseFrameRate('fast')).toBe(0);
    });
});

describe('buildCapFilters', () => {
    it('adds nothing when no caps are set', () => {
        expect(buildCapFilters(0, 0)).toEqual([]);
    });

    it('caps height and frame rate without upscaling', () => {
        expect(buildCapFilters(1080, 30)).toEqual([
            "fps='min(source_fps,30)'",
            "scale=-2:'min(ih,1080)'",
        ]);
    });

    it('supports a single cap', () => {
        expect(buildCapFilters(720, 0)).toEqual(["scale=-2:'min(ih,720)'"]);
        expect(buildCapFilters(0, 25)).toEqual(["fps='min(source_fps,25)'"]);
    });
});

describe('encoders', () => {
    it('uses libx264 for software encoding', () => {
        const settings = createEncoder('software', '/dev/dri/renderD128')(5000, 7500) as any;
        expect(settings.H264.name).toBe('libx264');
    });

    it('uses h264_vaapi with the configured device', () => {
        const settings = createEncoder('vaapi', '/dev/dri/renderD129')(5000, 7500) as any;
        expect(settings.H264.name).toBe('h264_vaapi');
        expect(settings.H264.globalOptions).toEqual(['-vaapi_device', '/dev/dri/renderD129']);
    });

    it('places cap filters before the GPU upload filters', () => {
        const encoder = withVideoFilters(createEncoder('vaapi', '/dev/dri/renderD128'), buildCapFilters(1080, 30));
        const settings = encoder(5000, 7500) as any;
        expect(settings.H264.outFilters).toEqual([
            "fps='min(source_fps,30)'",
            "scale=-2:'min(ih,1080)'",
            'format=nv12|vaapi',
            'hwupload',
        ]);
    });

    it('adds cap filters to software encoders', () => {
        const settings = withVideoFilters(createEncoder('software', ''), ['fps=30'])(5000, 7500) as any;
        expect(settings.H264.outFilters).toEqual(['fps=30']);
    });

    it('returns the original encoder when there are no filters', () => {
        const encoder = createEncoder('software', '');
        expect(withVideoFilters(encoder, [])).toBe(encoder);
    });
});

describe('isUsefulFfmpegLine', () => {
    it('drops the banner and build configuration', () => {
        expect(isUsefulFfmpegLine('ffmpeg version 7.1.5-0+deb13u1 Copyright (c) 2000-2026')).toBe(false);
        expect(isUsefulFfmpegLine('  built with gcc 14 (Debian 14.2.0-19)')).toBe(false);
        expect(isUsefulFfmpegLine('  configuration: --prefix=/usr')).toBe(false);
        expect(isUsefulFfmpegLine('  libavcodec     61. 19.101 / 61. 19.101')).toBe(false);
        expect(isUsefulFfmpegLine('   ')).toBe(false);
    });

    it('keeps errors and stream information', () => {
        expect(isUsefulFfmpegLine('[http @ 0x1] HTTP error 404 Not Found')).toBe(true);
        expect(isUsefulFfmpegLine('Error opening input files: Invalid data found when processing input')).toBe(true);
        expect(isUsefulFfmpegLine('  Stream #0:0: Video: hevc (Main 10), yuv420p10le, 3840x2160')).toBe(true);
    });
});

describe('buildPlaybackPlans', () => {
    it('falls back from GPU decoding to CPU decoding to CPU encoding', () => {
        expect(buildPlaybackPlans({ transcoding: true, encoder: 'vaapi', hardwareDecoding: true })).toEqual([
            { hardwareDecoding: true, encoder: 'vaapi' },
            { hardwareDecoding: false, encoder: 'vaapi' },
            { hardwareDecoding: false, encoder: 'software' },
        ]);
    });

    it('skips steps that are already off', () => {
        expect(buildPlaybackPlans({ transcoding: true, encoder: 'vaapi', hardwareDecoding: false })).toEqual([
            { hardwareDecoding: false, encoder: 'vaapi' },
            { hardwareDecoding: false, encoder: 'software' },
        ]);
        expect(buildPlaybackPlans({ transcoding: true, encoder: 'software', hardwareDecoding: false })).toEqual([
            { hardwareDecoding: false, encoder: 'software' },
        ]);
    });

    it('has a single attempt in passthrough mode', () => {
        expect(buildPlaybackPlans({ transcoding: false, encoder: 'vaapi', hardwareDecoding: true })).toHaveLength(1);
    });

    it('describes plans for the log', () => {
        expect(describePlaybackPlan({ hardwareDecoding: true, encoder: 'vaapi' })).toBe('GPU decoding + GPU (vaapi) encoding');
        expect(describePlaybackPlan({ hardwareDecoding: false, encoder: 'software' })).toBe('CPU decoding + CPU encoding');
    });
});

describe('HDR tone mapping', () => {
    it('parses the setting, defaulting to mobius', () => {
        expect(parseToneMapping(undefined)).toBe('mobius');
        expect(parseToneMapping('HABLE')).toBe('hable');
        expect(parseToneMapping('reinhard')).toBe('reinhard');
        expect(parseToneMapping('off')).toBe('off');
        expect(parseToneMapping('false')).toBe('off');
        expect(parseToneMapping('nonsense')).toBe('mobius');
    });

    it('detects PQ and HLG sources from FFmpeg stream info', () => {
        expect(isHdrStreamLine('  Stream #0:0[0x100]: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/smpte2084), 3840x2160')).toBe(true);
        expect(isHdrStreamLine('  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1920x1080')).toBe(true);
    });

    it('ignores SDR and wide-gamut-only sources', () => {
        expect(isHdrStreamLine('  Stream #0:0[0x100]: Video: hevc (Main), yuv420p(tv, bt709), 1280x720')).toBe(false);
        expect(isHdrStreamLine('  Stream #0:0: Video: hevc (Main 10), yuv420p10le(tv, bt2020nc/bt2020/bt2020-10), 3840x2160')).toBe(false);
        expect(isHdrStreamLine('  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo')).toBe(false);
    });

    it('converts to SDR BT.709 with the chosen curve', () => {
        const filters = buildToneMapFilters('mobius');
        expect(filters).toContain('tonemap=tonemap=mobius:desat=0');
        expect(filters.at(-1)).toBe('format=yuv420p');
    });

    it('runs after the caps and before the GPU upload', () => {
        const encoder = withVideoFilters(createEncoder('vaapi', '/dev/dri/renderD128'), [...buildCapFilters(1080, 25), ...buildToneMapFilters('hable')]);
        const filters = (encoder(5000, 7500) as any).H264.outFilters as string[];
        expect(filters.indexOf("scale=-2:'min(ih,1080)'")).toBeLessThan(filters.indexOf('tonemap=tonemap=hable:desat=0'));
        expect(filters.slice(-2)).toEqual(['format=nv12|vaapi', 'hwupload']);
    });
});
