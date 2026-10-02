import { describe, expect, it } from 'vitest';
import { createStreamEmbed, isChannel, isProgramme } from '../src/modules/embeds';
import { ProgrammeEmbedProcessor } from '../src/modules/embeds/programme';
import type { ChannelEntry, ProgrammeEntry } from '../src/interfaces/iptv';

function makeChannel(name = 'BBC One'): ChannelEntry {
    return { xui_id: 101, tvg_id: 'bbc1', tvg_name: name, group_title: 'UK', url: 'http://example.com/bbc1' };
}

function makeProgramme(overrides: Partial<ProgrammeEntry> = {}): ProgrammeEntry {
    const now = Math.floor(Date.now() / 1000);
    return {
        start: new Date((now - 60) * 1000).toISOString(),
        stop: new Date((now + 3600) * 1000).toISOString(),
        start_timestamp: now - 60,
        stop_timestamp: now + 3600,
        channel: 'bbc1',
        title: 'News',
        description: 'Daily news bulletin',
        category: 'News',
        created_at: new Date().toISOString(),
        ...overrides
    };
}

describe('type guards', () => {
    it('detects channels', () => {
        expect(isChannel(makeChannel())).toBe(true);
        expect(isChannel(makeProgramme())).toBe(false);
    });

    it('detects programmes', () => {
        expect(isProgramme(makeProgramme())).toBe(true);
        expect(isProgramme(makeChannel())).toBe(false);
    });
});

describe('createStreamEmbed', () => {
    it('includes now playing and upcoming sections', () => {
        const now = Math.floor(Date.now() / 1000);
        const upcoming = makeProgramme({
            start_timestamp: now + 3600,
            stop_timestamp: now + 7200,
            title: 'The Movie'
        });

        const embed = createStreamEmbed(makeChannel(), makeProgramme(), [upcoming]);
        const fieldNames = embed.data.fields?.map(field => field.name) ?? [];

        expect(embed.data.title).toContain('BBC One');
        expect(fieldNames).toContain('🔴 NOW PLAYING');
        expect(fieldNames).toContain('⏭️ UPCOMING');
    });

    it('handles a channel without programme information', () => {
        const embed = createStreamEmbed(makeChannel('CNN'));
        const nowPlaying = embed.data.fields?.find(field => field.name === '🔴 NOW PLAYING');

        expect(nowPlaying?.value).toContain('No current programme');
    });
});

describe('ProgrammeEmbedProcessor.generateProgrammeInfoEmbeds', () => {
    it('marks the current programme as live in the main embed', () => {
        const embeds = ProgrammeEmbedProcessor.generateProgrammeInfoEmbeds('BBC One', [makeProgramme()]);

        expect(embeds.length).toBeGreaterThan(0);
        expect(embeds[0]?.data.title).toContain('BBC One');
        expect(embeds[0]?.data.description).toContain('NOW LIVE');
    });

    it('returns no embeds when all programmes are in the past', () => {
        const past = makeProgramme({
            start_timestamp: Math.floor(Date.now() / 1000) - 7200,
            stop_timestamp: Math.floor(Date.now() / 1000) - 3600
        });
        expect(ProgrammeEmbedProcessor.generateProgrammeInfoEmbeds('BBC One', [past])).toEqual([]);
    });
});

describe('ProgrammeEmbedProcessor.generateChannelListEmbed', () => {
    it('uses the same page size as the command (20, not 25)', () => {
        const channels = Array.from({ length: 25 }, (_, index) => makeChannel(`Channel ${index + 1}`));
        const embed = ProgrammeEmbedProcessor.generateChannelListEmbed(channels, null, 2, 3);

        // Page 2 starts at item 21 because itemsPerPage is 20.
        expect(embed.data.fields?.[0]?.name).toBe('Channels 21-30');
    });
});
