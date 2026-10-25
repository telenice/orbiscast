import type { ChannelEntry, ProgrammeEntry } from '../../interfaces/iptv';

/**
 * A programme that matched a guide search, with every playable channel showing it.
 */
export interface ProgrammeSearchResult {
    programme: ProgrammeEntry;
    channels: ChannelEntry[];
    /** True while the programme is on air */
    live: boolean;
    /** Where the query matched: the title/subtitle, or only the description */
    matchedIn: 'title' | 'description';
}

export interface ProgrammeSearchOutcome {
    results: ProgrammeSearchResult[];
    /** Total matches before the result limit was applied */
    total: number;
}

/**
 * Normalizes text for matching: lower case, accents removed, punctuation
 * collapsed to spaces (so "Liverpool v. Man Utd" matches "liverpool man utd").
 *
 * @param text - Text to normalize
 * @returns Normalized text
 */
export function normalizeSearchText(text: string | undefined): string {
    return (text || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim();
}

/**
 * Splits a query into normalized search terms.
 *
 * @param query - Raw query
 * @returns Terms that must all match
 */
export function tokenizeQuery(query: string): string[] {
    return normalizeSearchText(query).split(' ').filter(Boolean);
}

/**
 * Searches the programme guide. Every term must appear in the programme's
 * title, subtitle or description. Programmes that already ended are skipped,
 * and only programmes on a playable channel (one with a stream URL) are returned.
 *
 * Results are ordered with title matches before description-only matches,
 * then by start time (so programmes on air now come first).
 *
 * @param programmes - Guide entries
 * @param channels - Known channels
 * @param query - Search text, e.g. "liverpool"
 * @param now - Current Unix time in seconds
 * @param limit - Maximum results to return
 * @returns Matching programmes and the total number of matches
 */
export function searchProgrammes(
    programmes: ProgrammeEntry[],
    channels: ChannelEntry[],
    query: string,
    now: number,
    limit = 10
): ProgrammeSearchOutcome {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) {
        return { results: [], total: 0 };
    }

    // Several channels can share one EPG id (e.g. HD and SD versions).
    const channelsById = new Map<string, ChannelEntry[]>();
    for (const channel of channels) {
        if (!channel.url || !channel.tvg_id) continue;
        const key = channel.tvg_id.toLowerCase();
        const list = channelsById.get(key);
        if (list) list.push(channel);
        else channelsById.set(key, [channel]);
    }

    const matches: ProgrammeSearchResult[] = [];
    const seen = new Set<string>();

    for (const programme of programmes) {
        if (typeof programme.stop_timestamp !== 'number' || programme.stop_timestamp <= now) continue;

        const playable = channelsById.get((programme.channel || '').toLowerCase());
        if (!playable) continue;

        const heading = normalizeSearchText(`${programme.title} ${programme.subtitle ?? ''}`);
        const inHeading = terms.every(term => heading.includes(term));
        let matchedIn: ProgrammeSearchResult['matchedIn'] = 'title';
        if (!inHeading) {
            const everything = `${heading} ${normalizeSearchText(programme.description)}`;
            if (!terms.every(term => everything.includes(term))) continue;
            matchedIn = 'description';
        }

        // Guides sometimes repeat an entry; keep one per channel and start time.
        const key = `${programme.channel}|${programme.start_timestamp}|${programme.title}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        matches.push({
            programme,
            channels: playable,
            live: programme.start_timestamp <= now,
            matchedIn,
        });
    }

    matches.sort((a, b) => {
        if (a.matchedIn !== b.matchedIn) return a.matchedIn === 'title' ? -1 : 1;
        return a.programme.start_timestamp - b.programme.start_timestamp;
    });

    return { results: matches.slice(0, Math.max(0, limit)), total: matches.length };
}
