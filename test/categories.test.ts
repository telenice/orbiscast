import { describe, expect, it } from 'vitest';
import { excludeCategories, matchesCategory, parseCategoryPatterns } from '../src/modules/iptv/categories';
import type { ChannelEntry } from '../src/interfaces/iptv';

const channel = (tvg_name: string, group_title: string): ChannelEntry => ({ xui_id: 0, tvg_id: '', tvg_name, tvg_logo: '', group_title, url: `http://x/${tvg_name}` });

describe('parseCategoryPatterns', () => {
    it('ignores empty input and blank entries', () => {
        expect(parseCategoryPatterns(undefined)).toEqual([]);
        expect(parseCategoryPatterns(' , ,')).toEqual([]);
    });

    it('matches whole names case-insensitively', () => {
        const patterns = parseCategoryPatterns('UK | 4K');
        expect(matchesCategory('uk | 4k', patterns)).toBe(true);
        expect(matchesCategory('UK | 4K Sports', patterns)).toBe(false);
    });

    it('supports * wildcards', () => {
        const patterns = parseCategoryPatterns('*4K*');
        expect(matchesCategory('UK | 4K', patterns)).toBe(true);
        expect(matchesCategory('4K UHD', patterns)).toBe(true);
        expect(matchesCategory('UK | Sports', patterns)).toBe(false);
    });

    it('treats regex characters literally', () => {
        const patterns = parseCategoryPatterns('US (4K)|.+');
        expect(matchesCategory('US (4K)|.+', patterns)).toBe(true);
        expect(matchesCategory('US 4K', patterns)).toBe(false);
    });

    it('never matches channels without a category', () => {
        expect(matchesCategory('', parseCategoryPatterns('*'))).toBe(false);
        expect(matchesCategory(undefined, parseCategoryPatterns('*'))).toBe(false);
    });
});

describe('excludeCategories', () => {
    const channels = [channel('BBC One', 'UK | Entertainment'), channel('BBC One 4K', 'UK | 4K'), channel('Sky UHD', '4K UHD')];

    it('keeps everything without patterns', () => {
        expect(excludeCategories(channels, [])).toBe(channels);
    });

    it('drops channels in excluded categories', () => {
        const kept = excludeCategories(channels, parseCategoryPatterns('*4K*'));
        expect(kept.map(c => c.tvg_name)).toEqual(['BBC One']);
    });
});
