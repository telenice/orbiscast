import { describe, expect, it } from 'vitest';
import { buildChannelChoices, channelDisplayName, channelKey, findChannel, sanitizeChannelId, findChannelBySanitizedId } from '../src/utils/channels';
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
    const ch = (tvg_name: string, group_title = ''): ChannelEntry => ({ xui_id: 0, tvg_name, group_title, url: `http://x/${tvg_name}/${group_title}` });
    const channels = [
        ch('BBC One HD', 'UK | Entertainment'),
        ch('Sky Sports Main Event', 'UK | Sports'),
        ch('TNT Sports 1', 'UK | Sports'),
        ch('No Category Channel'),
    ];
    const names = (choices: { name: string }[]) => choices.map(c => c.name);

    it('labels choices "Channel | Category" and uses the channel key as the value', () => {
        expect(buildChannelChoices(channels, 'bbc')).toEqual([
            { name: 'BBC One HD | UK | Entertainment', value: channelKey(channels[0]!) },
        ]);
    });

    it('omits the separator when there is no category', () => {
        expect(names(buildChannelChoices(channels, 'no cat'))).toEqual(['No Category Channel']);
    });

    it('lists name matches before category matches', () => {
        const list = [ch('Sports News', 'UK | News'), ...channels];
        expect(names(buildChannelChoices(list, 'sports')).slice(0, 3)).toEqual([
            'Sports News | UK | News',
            'Sky Sports Main Event | UK | Sports',
            'TNT Sports 1 | UK | Sports',
        ]);
        expect(names(buildChannelChoices(channels, 'entertainment'))).toEqual(['BBC One HD | UK | Entertainment']);
    });

    it('stays within Discord limits', () => {
        const long = ch('X'.repeat(150), 'Y'.repeat(80));
        const [choice] = buildChannelChoices([long], '');
        expect(choice!.name.length).toBeLessThanOrEqual(100);
        expect(choice!.name).toContain(' | YYY');
        expect(choice!.value.length).toBeLessThanOrEqual(100);
        const many = Array.from({ length: 40 }, (_, i) => ch(`Channel ${i}`));
        expect(buildChannelChoices(many, '')).toHaveLength(25);
    });

    it('keeps same-named channels from different categories apart', () => {
        const amc = [ch('AMC', 'US | Entertainment'), ch('AMC', 'CA | Movies'), ch('AMC', 'EU | General Channels'), ch('AMC Thrillers', 'US | Movies')];
        const choices = buildChannelChoices(amc, 'amc');
        expect(names(choices)).toEqual([
            'AMC | US | Entertainment',
            'AMC | CA | Movies',
            'AMC | EU | General Channels',
            'AMC Thrillers | US | Movies',
        ]);
        expect(new Set(choices.map(c => c.value)).size).toBe(4);
    });
});

describe('channelKey / findChannel', () => {
    const us = { xui_id: 1, tvg_name: 'AMC', group_title: 'US | Entertainment', url: 'http://x/live/u/p/1.ts' };
    const ca = { xui_id: 2, tvg_name: 'AMC', group_title: 'CA | Movies', url: 'http://x/live/u/p/2.ts' };

    it('is stable, short and safe for Discord custom IDs', () => {
        expect(channelKey(us)).toBe(channelKey({ ...us, tvg_name: 'Renamed' }));
        expect(channelKey(us)).not.toBe(channelKey(ca));
        expect(channelKey(us)).toMatch(/^c[0-9a-f]{11}$/);
    });

    it('resolves keys exactly and names case-insensitively', () => {
        expect(findChannel([us, ca], channelKey(ca))).toBe(ca);
        expect(findChannel([us, ca], 'amc')).toBe(us);
        expect(findChannel([us, ca], 'missing')).toBeUndefined();
        expect(findChannelBySanitizedId([us, ca], channelKey(ca))).toBe(ca);
    });

    it('shows the category in display names', () => {
        expect(channelDisplayName(ca)).toBe('AMC (CA | Movies)');
        expect(channelDisplayName({ xui_id: 0, tvg_name: 'Plain', url: 'u' })).toBe('Plain');
    });
});
