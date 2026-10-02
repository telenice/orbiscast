import { describe, expect, it } from 'vitest';
import { sanitizeChannelId, findChannelBySanitizedId } from '../src/utils/channels';
import type { ChannelEntry } from '../src/interfaces/iptv';

function channel(tvg_name: string): ChannelEntry {
    return { xui_id: 0, tvg_name, url: 'http://example.com/stream' };
}

describe('sanitizeChannelId', () => {
    it('replaces characters that are not word characters or dashes', () => {
        expect(sanitizeChannelId('BBC One HD')).toBe('BBC_One_HD');
        expect(sanitizeChannelId('Sky Sports 1')).toBe('Sky_Sports_1');
    });

    it('replaces non-ascii characters as well', () => {
        expect(sanitizeChannelId('Café-TV')).toBe('Caf_-TV');
    });

    it('truncates long names to 80 characters', () => {
        const longName = 'A'.repeat(120);
        expect(sanitizeChannelId(longName)).toHaveLength(80);
    });
});

describe('findChannelBySanitizedId', () => {
    const channels = [channel('BBC One HD'), channel('CNN'), channel('Sky Sports 1')];

    it('finds a channel by its sanitized name', () => {
        expect(findChannelBySanitizedId(channels, 'BBC_One_HD')?.tvg_name).toBe('BBC One HD');
        expect(findChannelBySanitizedId(channels, 'Sky_Sports_1')?.tvg_name).toBe('Sky Sports 1');
    });

    it('returns undefined when nothing matches', () => {
        expect(findChannelBySanitizedId(channels, 'Does_Not_Exist')).toBeUndefined();
    });

    it('ignores channels without a name', () => {
        const unnamed: ChannelEntry = { xui_id: 0, url: 'http://example.com/x' };
        expect(findChannelBySanitizedId([unnamed], 'anything')).toBeUndefined();
    });
});
