import { describe, expect, it } from 'vitest';
import { buildChannelChoices, sanitizeChannelId, findChannelBySanitizedId } from '../src/utils/channels';
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

describe('buildChannelChoices', () => {
    const ch = (tvg_name: string, group_title = ''): ChannelEntry => ({ xui_id: 0, tvg_name, group_title, url: 'u' });
    const channels = [
        ch('BBC One HD', 'UK | Entertainment'),
        ch('Sky Sports Main Event', 'UK | Sports'),
        ch('TNT Sports 1', 'UK | Sports'),
        ch('No Category Channel'),
    ];

    it('labels choices "Channel | Category" and keeps the name as the value', () => {
        expect(buildChannelChoices(channels, 'bbc')).toEqual([
            { name: 'BBC One HD | UK | Entertainment', value: 'BBC One HD' },
        ]);
    });

    it('omits the separator when there is no category', () => {
        expect(buildChannelChoices(channels, 'no cat')).toEqual([
            { name: 'No Category Channel', value: 'No Category Channel' },
        ]);
    });

    it('lists name matches before category matches', () => {
        const values = buildChannelChoices([ch('Sports News', 'UK | News'), ...channels], 'sports').map(c => c.value);
        expect(values.slice(0, 3)).toEqual(['Sports News', 'Sky Sports Main Event', 'TNT Sports 1']);
        expect(buildChannelChoices(channels, 'entertainment').map(c => c.value)).toEqual(['BBC One HD']);
    });

    it('stays within Discord limits', () => {
        const long = ch('X'.repeat(150), 'Y'.repeat(80));
        const [choice] = buildChannelChoices([long], '');
        expect(choice!.name.length).toBeLessThanOrEqual(100);
        expect(choice!.name).toContain(' | YYY');
        expect(choice!.value.length).toBe(100);
        const many = Array.from({ length: 40 }, (_, i) => ch(`Channel ${i}`));
        expect(buildChannelChoices(many, '')).toHaveLength(25);
    });

    it('does not repeat a channel name', () => {
        expect(buildChannelChoices([ch('Dup', 'A'), ch('Dup', 'B')], 'dup')).toHaveLength(1);
    });
});
