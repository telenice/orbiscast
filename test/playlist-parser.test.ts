import { describe, expect, it } from 'vitest';
import { fromPlaylistLine } from '../src/modules/iptv/parsers/playlist-parser';

describe('fromPlaylistLine', () => {
    it('parses the original xui-style format', () => {
        const line = '#EXTINF:-1 channelID="123" tvg-chno="5" tvg-name="BBC One" tvg-id="bbc1" tvg-logo="http://example.com/bbc1.png" group-title="UK: | News",BBC One';
        const channel = fromPlaylistLine(line);

        expect(channel).not.toBeNull();
        expect(channel?.xui_id).toBe(123);
        expect(channel?.tvg_id).toBe('bbc1');
        expect(channel?.tvg_name).toBe('BBC One');
        expect(channel?.tvg_logo).toBe('http://example.com/bbc1.png');
        expect(channel?.group_title).toBe('UK: | News');
        expect(channel?.country).toBe('UK');
    });

    it('parses the alternative attribute format', () => {
        const line = '#EXTINF:-1 tvg-id="cnn" tvg-name="CNN" tvg-logo="http://example.com/cnn.png" group-title="US",CNN HD';
        const channel = fromPlaylistLine(line);

        expect(channel?.tvg_id).toBe('cnn');
        expect(channel?.tvg_name).toBe('CNN');
        expect(channel?.country).toBe('US');
    });

    it('falls back to the display name when tvg-name is missing', () => {
        const line = '#EXTINF:-1 tvg-id="discovery" group-title="Docs",Discovery Channel';
        const channel = fromPlaylistLine(line);

        expect(channel?.tvg_id).toBe('discovery');
        expect(channel?.tvg_name).toBe('Discovery Channel');
    });

    it('returns null for non EXTINF lines', () => {
        expect(fromPlaylistLine('http://example.com/stream')).toBeNull();
    });
});
