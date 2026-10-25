import { describe, expect, it } from 'vitest';
import { buildGuideFilter, mergeChannelLists } from '../src/modules/iptv/merge';
import type { ChannelEntry } from '../src/interfaces/iptv';

const guide = (tvg_id: string, tvg_name: string): ChannelEntry => ({ xui_id: 0, tvg_id, tvg_name, tvg_logo: 'guide.png', group_title: '', url: '' });
const source = (tvg_id: string, tvg_name: string, url: string, group_title = 'UK'): ChannelEntry => ({ xui_id: 1, tvg_id, tvg_name, tvg_logo: '', group_title, url });

describe('mergeChannelLists', () => {
    it('attaches URLs to guide channels matched by name', () => {
        const merged = mergeChannelLists([guide('bbc1.uk', 'BBC One')], [source('bbc1.uk', 'BBC One', 'u1')]);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ tvg_name: 'BBC One', url: 'u1', tvg_logo: 'guide.png', group_title: 'UK' });
    });

    it('matches by tvg_id when names differ and adopts the provider name', () => {
        const merged = mergeChannelLists([guide('bbc1.uk', 'BBC One')], [source('bbc1.uk', 'UK: BBC One HD', 'u1')]);
        expect(merged).toHaveLength(1);
        expect(merged[0]).toMatchObject({ tvg_name: 'UK: BBC One HD', tvg_id: 'bbc1.uk', url: 'u1' });
    });

    it('keeps every variant that shares an EPG id', () => {
        const merged = mergeChannelLists([guide('bbc1.uk', 'BBC One')], [
            source('bbc1.uk', 'BBC One HD', 'hd'),
            source('bbc1.uk', 'BBC One SD', 'sd'),
        ]);
        expect(merged.map(c => c.url).sort()).toEqual(['hd', 'sd']);
        expect(merged.every(c => c.tvg_id === 'bbc1.uk')).toBe(true);
    });

    it('drops previously synced channels no longer offered by a source', () => {
        const existing = [guide('itv1.uk', 'ITV1'), source('old.uk', 'Old Channel', 'old')];
        const merged = mergeChannelLists(existing, [source('bbc1.uk', 'BBC One', 'u1')]);
        expect(merged.map(c => c.tvg_name).sort()).toEqual(['BBC One', 'ITV1']);
    });

    it('keeps same-named channels from different categories as separate entries', () => {
        const merged = mergeChannelLists([], [
            source('amc.us', 'AMC', 'us', 'US | Entertainment'),
            source('amc.ca', 'AMC', 'ca', 'CA | Movies'),
            source('amc.eu', 'AMC', 'eu1', 'EU | General Channels'),
            source('amc.eu', 'AMC', 'eu2', 'EU | General Channels'),
        ]);
        expect(merged.map(c => c.url)).toEqual(['us', 'ca', 'eu1', 'eu2']);
    });

    it('drops exact duplicate stream URLs', () => {
        expect(mergeChannelLists([], [source('a', 'A', 'same'), source('a', 'A again', 'same')])).toHaveLength(1);
    });

    it('does not mutate its inputs', () => {
        const existing = [guide('bbc1.uk', 'BBC One')];
        mergeChannelLists(existing, [source('bbc1.uk', 'BBC One HD', 'u1')]);
        expect(existing[0]).toMatchObject({ tvg_name: 'BBC One', url: '' });
    });
});

describe('buildGuideFilter', () => {
    it('collects lower-cased ids and names', () => {
        expect(buildGuideFilter([source('BBC1.uk', 'BBC One', 'u')])).toEqual(new Set(['bbc1.uk', 'bbc one']));
    });

    it('returns undefined when there is nothing to filter by', () => {
        expect(buildGuideFilter([])).toBeUndefined();
    });
});
