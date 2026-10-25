import type { ChannelEntry } from '../../../interfaces/iptv';

/**
 * Credentials for an Xtream Codes compatible IPTV provider.
 */
export interface XtreamCredentials {
    host: string;
    username: string;
    password: string;
}

/**
 * A live stream as returned by `player_api.php?action=get_live_streams`.
 * Providers are inconsistent about types, so numeric fields may arrive as strings.
 */
export interface XtreamLiveStream {
    num?: number | string;
    name?: string;
    stream_type?: string;
    stream_id: number | string;
    stream_icon?: string | null;
    epg_channel_id?: string | null;
    category_id?: string | number | null;
    direct_source?: string | null;
}

/**
 * A category as returned by `player_api.php?action=get_live_categories`.
 */
export interface XtreamCategory {
    category_id: string | number;
    category_name: string;
    parent_id?: number | string;
}

export type XtreamOutput = 'ts' | 'm3u8';

/**
 * Normalizes an Xtream host so it can be used as a base URL.
 * Accepts values such as `example.com:8080`, `http://example.com:8080/`,
 * or a pasted `http://example.com:8080/player_api.php?...` / `get.php?...` URL.
 *
 * @param host - Raw host value from configuration
 * @returns Base URL with scheme and without a trailing slash
 */
export function normalizeXtreamHost(host: string): string {
    let base = host.trim();
    if (!base) {
        return '';
    }
    if (!/^https?:\/\//i.test(base)) {
        base = `http://${base}`;
    }
    // Drop any query string and known endpoint file names that may have been pasted in.
    base = base.split('?')[0] ?? base;
    base = base.replace(/\/(player_api|get|xmltv|panel_api)\.php$/i, '');
    return base.replace(/\/+$/, '');
}

/**
 * Builds a `player_api.php` URL for the given action.
 *
 * @param creds - Xtream credentials
 * @param action - API action (e.g. `get_live_streams`), omit for account info
 * @returns Fully qualified API URL
 */
export function buildXtreamApiUrl(creds: XtreamCredentials, action?: string): string {
    const params = new URLSearchParams({ username: creds.username, password: creds.password });
    if (action) {
        params.set('action', action);
    }
    return `${normalizeXtreamHost(creds.host)}/player_api.php?${params.toString()}`;
}

/**
 * Builds the XMLTV (EPG) URL that Xtream providers expose.
 *
 * @param creds - Xtream credentials
 * @returns Fully qualified XMLTV URL
 */
export function buildXtreamXmltvUrl(creds: XtreamCredentials): string {
    const params = new URLSearchParams({ username: creds.username, password: creds.password });
    return `${normalizeXtreamHost(creds.host)}/xmltv.php?${params.toString()}`;
}

/**
 * Builds the playable URL for a live stream.
 *
 * @param creds - Xtream credentials
 * @param streamId - Xtream stream ID
 * @param output - Container format, `ts` (MPEG-TS) or `m3u8` (HLS)
 * @returns Fully qualified stream URL
 */
export function buildXtreamStreamUrl(creds: XtreamCredentials, streamId: number | string, output: XtreamOutput = 'ts'): string {
    const user = encodeURIComponent(creds.username);
    const pass = encodeURIComponent(creds.password);
    return `${normalizeXtreamHost(creds.host)}/live/${user}/${pass}/${streamId}.${output}`;
}

/**
 * Parses a comma-separated category filter. Entries may be category IDs or names (case-insensitive).
 *
 * @param value - Raw filter value
 * @returns Lower-cased filter entries
 */
export function parseCategoryFilter(value: string | undefined): string[] {
    return (value || '')
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean);
}

export interface XtreamConversionOptions {
    output?: XtreamOutput;
    /** Category IDs or names to keep. Empty keeps everything. */
    categoryFilter?: string[];
    createdAt?: string;
}

/**
 * Converts Xtream live streams into channel entries understood by the rest of OrbisCast.
 *
 * @param streams - Live streams from the Xtream API
 * @param categories - Live categories from the Xtream API
 * @param creds - Xtream credentials (used to build stream URLs)
 * @param options - Output format, category filter and timestamp
 * @returns Channel entries
 */
export function xtreamStreamsToChannels(
    streams: XtreamLiveStream[],
    categories: XtreamCategory[],
    creds: XtreamCredentials,
    options: XtreamConversionOptions = {}
): ChannelEntry[] {
    const output = options.output ?? 'ts';
    const filter = options.categoryFilter ?? [];
    const createdAt = options.createdAt ?? new Date().toISOString();

    const categoryNames = new Map<string, string>();
    for (const category of categories || []) {
        categoryNames.set(String(category.category_id), category.category_name);
    }

    const channels: ChannelEntry[] = [];
    for (const stream of streams || []) {
        if (!stream || stream.stream_id === undefined || stream.stream_id === null || stream.stream_id === '') {
            continue;
        }
        if (stream.stream_type && stream.stream_type !== 'live' && stream.stream_type !== 'created_live') {
            continue;
        }

        const categoryId = stream.category_id !== undefined && stream.category_id !== null ? String(stream.category_id) : '';
        const groupTitle = categoryNames.get(categoryId) || '';

        if (filter.length > 0) {
            const matches = filter.includes(categoryId.toLowerCase()) || filter.includes(groupTitle.toLowerCase());
            if (!matches) {
                continue;
            }
        }

        const name = (stream.name || '').trim() || `Stream ${stream.stream_id}`;
        const [prefix] = groupTitle.split(': |');

        channels.push({
            xui_id: parseInt(String(stream.stream_id)) || 0,
            tvg_id: stream.epg_channel_id?.trim() || '',
            tvg_name: name,
            tvg_logo: stream.stream_icon?.trim() || '',
            group_title: groupTitle,
            url: buildXtreamStreamUrl(creds, stream.stream_id, output),
            created_at: createdAt,
            country: prefix
        });
    }

    return channels;
}
