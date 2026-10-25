import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { getCachedFile } from '../../utils/cache';
import { fetchWithRetry } from './downloaders';
import { buildXtreamApiUrl, xtreamStreamsToChannels } from './parsers/xtream-parser';
import type { XtreamCategory, XtreamCredentials, XtreamLiveStream } from './parsers/xtream-parser';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();

/**
 * Returns the configured Xtream credentials.
 */
export function getXtreamCredentials(): XtreamCredentials {
    return {
        host: config.XTREAM_HOST,
        username: config.XTREAM_USERNAME,
        password: config.XTREAM_PASSWORD,
    };
}

/**
 * Fetches and parses a JSON response from the Xtream API, using the cache unless forced.
 *
 * @param url - API URL
 * @param cacheFileName - Cache file name
 * @param force - Skip the cache
 * @returns Parsed JSON or null on failure
 */
async function fetchXtreamJson<T>(url: string, cacheFileName: string, force: boolean): Promise<T | null> {
    let content: Buffer | null = force ? null : await getCachedFile(cacheFileName);
    if (!content) {
        content = await fetchWithRetry(url, cacheFileName);
    }
    if (!content) {
        return null;
    }
    try {
        return JSON.parse(content.toString()) as T;
    } catch (error) {
        logger.error(`Xtream API returned invalid JSON for ${cacheFileName}: ${error}`);
        return null;
    }
}

/**
 * Logs the Xtream account status (active/expired, expiry date, connection limit).
 * Failures are logged but never fatal.
 */
async function logXtreamAccountInfo(creds: XtreamCredentials, force: boolean): Promise<void> {
    const info = await fetchXtreamJson<{ user_info?: Record<string, any> }>(
        buildXtreamApiUrl(creds), 'xtream_account.json', force
    );
    const user = info?.user_info;
    if (!user) {
        logger.warn('Could not read Xtream account info');
        return;
    }
    if (String(user.auth) === '0') {
        logger.error('Xtream provider rejected the credentials (auth=0). Check XTREAM_USERNAME and XTREAM_PASSWORD.');
        return;
    }
    const expiry = user.exp_date ? new Date(parseInt(user.exp_date) * 1000).toISOString() : 'never';
    logger.info(`Xtream account status: ${user.status ?? 'unknown'}, expires: ${expiry}, max connections: ${user.max_connections ?? '?'}`);
    if (user.status && String(user.status).toLowerCase() !== 'active') {
        logger.warn(`Xtream account is not active (status: ${user.status}); streams may fail`);
    }
}

/**
 * Downloads live channels from the configured Xtream Codes API.
 *
 * @param force - Skip cached API responses
 * @returns Channel entries (empty on failure)
 */
export async function fetchXtreamChannels(force = false): Promise<ChannelEntry[]> {
    const creds = getXtreamCredentials();
    logger.info('Retrieving channels from Xtream API...');

    await logXtreamAccountInfo(creds, force);

    const streams = await fetchXtreamJson<XtreamLiveStream[]>(
        buildXtreamApiUrl(creds, 'get_live_streams'), 'xtream_live_streams.json', force
    );
    if (!Array.isArray(streams)) {
        logger.error('Failed to retrieve live streams from Xtream API');
        return [];
    }

    const categories = await fetchXtreamJson<XtreamCategory[]>(
        buildXtreamApiUrl(creds, 'get_live_categories'), 'xtream_live_categories.json', force
    );
    if (!Array.isArray(categories)) {
        logger.warn('Failed to retrieve live categories from Xtream API; channels will have no category');
    }

    const channels = xtreamStreamsToChannels(streams, Array.isArray(categories) ? categories : [], creds, {
        output: config.XTREAM_OUTPUT,
        categoryFilter: config.XTREAM_CATEGORIES,
    });

    if (config.XTREAM_CATEGORIES.length > 0) {
        logger.info(`Xtream category filter kept ${channels.length} of ${streams.length} live streams`);
    } else {
        logger.info(`Extracted ${channels.length} channels from Xtream API`);
    }

    return channels;
}
