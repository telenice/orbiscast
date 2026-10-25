import { describe, expect, it } from 'vitest';
import { normalizeSearchText, searchProgrammes, tokenizeQuery } from '../src/modules/iptv/search';
import { buildSearchEmbed } from '../src/modules/embeds/search';
import { buildSearchButtons } from '../src/modules/commands/search';
import type { ChannelEntry, ProgrammeEntry } from '../src/interfaces/iptv';

const NOW = 1_800_000_000;
const HOUR = 3600;

const channel = (tvg_id: string, tvg_name: string, url = `http://x/${tvg_name}`): ChannelEntry => ({ xui_id: 0, tvg_id, tvg_name, url });
const prog = (channelId: string, title: string, startOffset: number, extra: Partial<ProgrammeEntry> = {}): ProgrammeEntry => ({
    start: '', stop: '', created_at: '', category: '', description: '',
    channel: channelId,
    title,
    start_timestamp: NOW + startOffset,
    stop_timestamp: NOW + startOffset + 2 * HOUR,
    ...extra,
});

const channels = [
    channel('skyme.uk', 'Sky Sports Main Event HD'),
    channel('skyme.uk', 'Sky Sports Main Event SD'),
    channel('tnt1.uk', 'TNT Sports 1'),
    channel('bbc1.uk', 'BBC One'),
    channel('noplay.uk', 'Guide Only', ''),
];

const programmes = [
    prog('skyme.uk', 'Premier League: Liverpool v Arsenal', 24 * HOUR),
    prog('tnt1.uk', 'Champions League: Real Madrid v Liverpool', -HOUR),
    prog('bbc1.uk', 'Match of the Day', 30 * HOUR, { description: 'Highlights including Liverpool against Arsenal.' }),
    prog('skyme.uk', 'Liverpool v Everton', -5 * HOUR),
    prog('noplay.uk', 'Liverpool Classics', 2 * HOUR),
    prog('bbc1.uk', 'Newsnight', HOUR),
];

describe('normalizeSearchText / tokenizeQuery', () => {
    it('lower-cases, strips accents and punctuation', () => {
        expect(normalizeSearchText('Atlético Madrid v. Liverpool!')).toBe('atletico madrid v liverpool');
        expect(tokenizeQuery('  Liverpool   ARSENAL ')).toEqual(['liverpool', 'arsenal']);
    });
});

describe('searchProgrammes', () => {
    it('finds title matches first, live ones first, then description matches', () => {
        const { results, total } = searchProgrammes(programmes, channels, 'liverpool', NOW);
        expect(total).toBe(3);
        expect(results.map(r => r.programme.title)).toEqual([
            'Champions League: Real Madrid v Liverpool',
            'Premier League: Liverpool v Arsenal',
            'Match of the Day',
        ]);
        expect(results[0]?.live).toBe(true);
        expect(results[2]?.matchedIn).toBe('description');
    });

    it('skips finished programmes and channels that cannot be played', () => {
        const titles = searchProgrammes(programmes, channels, 'liverpool', NOW).results.map(r => r.programme.title);
        expect(titles).not.toContain('Liverpool v Everton');
        expect(titles).not.toContain('Liverpool Classics');
    });

    it('lists every channel sharing the EPG id', () => {
        const match = searchProgrammes(programmes, channels, 'liverpool arsenal', NOW).results[0];
        expect(match?.channels.map(c => c.tvg_name)).toEqual(['Sky Sports Main Event HD', 'Sky Sports Main Event SD']);
    });

    it('requires every word to match', () => {
        const titles = searchProgrammes(programmes, channels, 'liverpool madrid', NOW).results.map(r => r.programme.title);
        expect(titles).toEqual(['Champions League: Real Madrid v Liverpool']);
    });

    it('limits results but reports the total', () => {
        const outcome = searchProgrammes(programmes, channels, 'liverpool', NOW, 1);
        expect(outcome.results).toHaveLength(1);
        expect(outcome.total).toBe(3);
    });

    it('returns nothing for an empty query', () => {
        expect(searchProgrammes(programmes, channels, ' !! ', NOW)).toEqual({ results: [], total: 0 });
    });

    it('drops duplicate guide entries', () => {
        const dupes = [...programmes, prog('skyme.uk', 'Premier League: Liverpool v Arsenal', 24 * HOUR)];
        expect(searchProgrammes(dupes, channels, 'arsenal liverpool', NOW).total).toBe(2);
    });
});

describe('search output', () => {
    const outcome = searchProgrammes(programmes, channels, 'liverpool', NOW);

    it('renders times as Discord timestamps and marks live programmes', () => {
        const text = buildSearchEmbed('liverpool', outcome).toJSON().description ?? '';
        expect(text).toContain('Live now');
        expect(text).toContain(`<t:${NOW + 24 * HOUR}:f>`);
        expect(text).toContain('Sky Sports Main Event HD, Sky Sports Main Event SD');
        expect(text).toContain('Mentioned in the description');
    });

    it('creates one uniquely identified watch button per result', () => {
        const rows = buildSearchButtons(outcome.results);
        const buttons = rows.flatMap(row => row.toJSON().components) as any[];
        expect(buttons).toHaveLength(3);
        expect(new Set(buttons.map(b => b.custom_id)).size).toBe(3);
        expect(buttons[0].label).toContain('TNT Sports 1');
        expect(buttons.every(b => b.custom_id.length <= 100 && b.label.length <= 80)).toBe(true);
    });

    it('fits ten results into at most two button rows', () => {
        const many = Array.from({ length: 10 }, () => outcome.results[1]!);
        expect(buildSearchButtons(many)).toHaveLength(2);
    });
});
