import { describe, expect, it } from 'vitest';
import {
    buildXtreamApiUrl,
    buildXtreamStreamUrl,
    buildXtreamXmltvUrl,
    normalizeXtreamHost,
    parseCategoryFilter,
    xtreamStreamsToChannels,
} from '../src/modules/iptv/parsers/xtream-parser';
import { redactUrl } from '../src/utils/redact';

const creds = { host: 'http://example.com:8080', username: 'user', password: 'p@ss' };

describe('normalizeXtreamHost', () => {
    it('adds a scheme and strips trailing slashes', () => {
        expect(normalizeXtreamHost('example.com:8080/')).toBe('http://example.com:8080');
    });

    it('keeps https', () => {
        expect(normalizeXtreamHost('https://example.com')).toBe('https://example.com');
    });

    it('strips pasted endpoint paths and query strings', () => {
        expect(normalizeXtreamHost('http://example.com:8080/get.php?username=a&password=b&type=m3u')).toBe('http://example.com:8080');
        expect(normalizeXtreamHost('http://example.com:8080/player_api.php')).toBe('http://example.com:8080');
    });
});

describe('Xtream URL builders', () => {
    it('builds API URLs with an action', () => {
        expect(buildXtreamApiUrl(creds, 'get_live_streams'))
            .toBe('http://example.com:8080/player_api.php?username=user&password=p%40ss&action=get_live_streams');
    });

    it('builds API URLs without an action', () => {
        expect(buildXtreamApiUrl(creds)).toBe('http://example.com:8080/player_api.php?username=user&password=p%40ss');
    });

    it('builds the XMLTV URL', () => {
        expect(buildXtreamXmltvUrl(creds)).toBe('http://example.com:8080/xmltv.php?username=user&password=p%40ss');
    });

    it('builds stream URLs in ts and m3u8', () => {
        expect(buildXtreamStreamUrl(creds, 42)).toBe('http://example.com:8080/live/user/p%40ss/42.ts');
        expect(buildXtreamStreamUrl(creds, '42', 'm3u8')).toBe('http://example.com:8080/live/user/p%40ss/42.m3u8');
    });
});

describe('parseCategoryFilter', () => {
    it('splits, trims and lower-cases entries', () => {
        expect(parseCategoryFilter(' 12, UK | Sports ,,')).toEqual(['12', 'uk | sports']);
    });

    it('returns an empty list when unset', () => {
        expect(parseCategoryFilter(undefined)).toEqual([]);
    });
});

describe('xtreamStreamsToChannels', () => {
    const categories = [
        { category_id: '1', category_name: 'UK | Entertainment' },
        { category_id: 2, category_name: 'Sports' },
    ];
    const streams = [
        { num: 1, name: 'BBC One', stream_type: 'live', stream_id: 101, stream_icon: 'http://logo/bbc1.png', epg_channel_id: 'bbc1.uk', category_id: '1' },
        { num: 2, name: 'Sky Sports', stream_type: 'live', stream_id: '202', stream_icon: null, epg_channel_id: null, category_id: 2 },
        { num: 3, name: 'A Movie', stream_type: 'movie', stream_id: 303, category_id: '1' },
        { num: 4, name: '', stream_type: 'live', stream_id: 404, category_id: '99' },
    ];

    it('maps live streams to channel entries', () => {
        const channels = xtreamStreamsToChannels(streams, categories, creds, { createdAt: '2026-01-01T00:00:00.000Z' });

        expect(channels).toHaveLength(3);
        expect(channels[0]).toEqual({
            xui_id: 101,
            tvg_id: 'bbc1.uk',
            tvg_name: 'BBC One',
            tvg_logo: 'http://logo/bbc1.png',
            group_title: 'UK | Entertainment',
            url: 'http://example.com:8080/live/user/p%40ss/101.ts',
            created_at: '2026-01-01T00:00:00.000Z',
            country: 'UK | Entertainment',
        });
        expect(channels[1]?.group_title).toBe('Sports');
        expect(channels[1]?.tvg_id).toBe('');
        expect(channels[1]?.tvg_logo).toBe('');
        expect(channels[2]?.tvg_name).toBe('Stream 404');
        expect(channels[2]?.group_title).toBe('');
    });

    it('uses the requested output format', () => {
        const [channel] = xtreamStreamsToChannels(streams.slice(0, 1), categories, creds, { output: 'm3u8' });
        expect(channel?.url.endsWith('/101.m3u8')).toBe(true);
    });

    it('filters by category id or name', () => {
        const byId = xtreamStreamsToChannels(streams, categories, creds, { categoryFilter: ['2'] });
        expect(byId.map(c => c.tvg_name)).toEqual(['Sky Sports']);

        const byName = xtreamStreamsToChannels(streams, categories, creds, { categoryFilter: ['uk | entertainment'] });
        expect(byName.map(c => c.tvg_name)).toEqual(['BBC One']);
    });

    it('tolerates missing categories', () => {
        const channels = xtreamStreamsToChannels(streams.slice(0, 1), [], creds);
        expect(channels[0]?.group_title).toBe('');
    });
});

describe('redactUrl', () => {
    it('masks Xtream stream path credentials', () => {
        expect(redactUrl('http://example.com:8080/live/user/secret/101.ts')).toBe('http://example.com:8080/live/***/***/101.ts');
    });

    it('masks query string credentials', () => {
        expect(redactUrl('http://example.com/player_api.php?username=user&password=secret&action=get_live_streams'))
            .toBe('http://example.com/player_api.php?username=***&password=***&action=get_live_streams');
    });

    it('masks userinfo', () => {
        expect(redactUrl('http://user:secret@example.com/list.m3u')).toBe('http://***@example.com/list.m3u');
    });

    it('leaves plain URLs alone', () => {
        expect(redactUrl('http://example.com/playlist.m3u')).toBe('http://example.com/playlist.m3u');
    });
});

describe('redactUrl in error output', () => {
    it('masks every occurrence of a stream URL', () => {
        const err = "ffmpeg -i 'https://h/live/u1/p1/1.ts' failed\nInput #0, mpegts, from 'https://h/live/u1/p1/1.ts':";
        const redacted = redactUrl(err);
        expect(redacted).not.toContain('u1');
        expect(redacted).not.toContain('p1');
    });
});
