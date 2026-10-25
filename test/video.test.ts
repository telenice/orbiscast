import { describe, expect, it } from 'vitest';
import { buildCapFilters, isUsefulFfmpegLine, parseFrameRate, parseResolution } from '../src/modules/streaming/video-options';
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
            "scale=-2:'min(ih,1080)'",
            "fps='min(source_fps,30)'",
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
            "scale=-2:'min(ih,1080)'",
            "fps='min(source_fps,30)'",
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
