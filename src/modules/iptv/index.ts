import { getLogger } from '../../utils/logger';
import { config } from '../../utils/config';
import { clearCache, getCachedFile } from '../../utils/cache';
import { clearChannels, addChannels, clearProgrammes, addProgrammes, getChannelEntries } from '../database';
import { fetchWithRetry, streamWithRetry } from './downloaders';
import { fromPlaylistLine } from './parsers/playlist-parser';
import { parseXMLTVStream } from './parsers/xmltv-parser';
import { isProgrammeDataStale } from './utils';
import { scheduleIPTVRefresh } from './schedulers';
import { fetchXtreamChannels } from './xtream';
import { buildGuideFilter, mergeChannelLists } from './merge';
import type { ChannelEntry } from '../../interfaces/iptv';

const logger = getLogger();

/**
 * Downloads IPTV data, caches it, and populates the database with channels and programmes.
 * This is the main entry point for IPTV data initialization.
 * 
 * @param force - Whether to force download even if cache exists
 */
export async function downloadCacheAndFillDb(force = false): Promise<void> {
    logger.debug(`Initiating IPTV data download and database population (force: ${force})`);

    // Fetch the playable channels first so the guide can be filtered down to them.
    const sourceChannels = await fetchSourceChannels(force);

    const alreadyMerged = config.XMLTV ? await populateDatabaseFromXMLTV(force, sourceChannels) : false;

    // Merge stream URLs from the M3U playlist and/or Xtream API
    if (alreadyMerged) {
        logger.debug('Channels already merged during guide import');
    } else if (sourceChannels.length > 0) {
        await mergeChannelsIntoDatabase(sourceChannels);
    } else {
        logger.warn('No channels retrieved from any source; keeping existing database');
    }

    logger.debug('Database population completed');
    await clearCache();

    // Schedule automatic refresh for subsequent updates
    if (!force) {
        scheduleIPTVRefresh();
    }
}

/**
 * Populates the database with channels and programmes extracted from XMLTV source.
 * The guide is streamed and parsed on the fly, keeping only entries for playable
 * channels, so full-provider guides of hundreds of MB are handled without
 * loading them into memory.
 *
 * @param force - Force download even if the stored guide is still fresh
 * @param sourceChannels - Playable channels to filter the guide to. When omitted,
 *   channels with a stream URL already in the database are used.
 * @returns True if the playable channels were already merged into the database
 */
export async function populateDatabaseFromXMLTV(force = false, sourceChannels?: ChannelEntry[]): Promise<boolean> {
    let merged = false;
    logger.debug('Initiating database population from XMLTV source');

    const isStale = await isProgrammeDataStale();

    if (!isStale && !force) {
        logger.info('TV Schedule and channels are up to date');
        return false;
    }

    const playable = sourceChannels ?? (await getChannelEntries()).filter(ch => ch.url);
    const wanted = buildGuideFilter(playable);
    if (wanted) {
        logger.info(`Fetching XMLTV, keeping guide data for ${playable.length} channels...`);
    } else {
        logger.info('Fetching XMLTV...');
    }

    // Keep an hour of past programmes so "now playing" is still correct at refresh
    // time, and only XMLTV_DAYS of upcoming listings to keep the database small.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const dropEndedBefore = nowSeconds - 3600;
    const dropStartingAfter = config.XMLTV_DAYS > 0 ? nowSeconds + Math.round(config.XMLTV_DAYS * 86400) : undefined;
    const parsedData = await streamWithRetry(config.XMLTV, stream => parseXMLTVStream(stream, { wanted, dropEndedBefore, dropStartingAfter }));

    if (!parsedData) {
        logger.error('Failed to fetch XMLTV content; keeping existing guide data');
        return false;
    }

    if (wanted && parsedData.channels.length === 0 && parsedData.programmes.length === 0) {
        logger.warn('No guide entries matched your channels. Check that tvg-id / Xtream epg_channel_id values match the guide\'s channel ids.');
    }

    // Add channels from XMLTV if available
    if (parsedData.channels.length > 0) {
        await clearChannels();
        await addChannels(parsedData.channels);
        logger.info(`Added ${parsedData.channels.length} channels from XMLTV`);

        // Re-attach the playable channels so a programme-only refresh does not
        // leave channels without anything to play.
        if (playable.length > 0) {
            await mergeChannelsIntoDatabase(playable);
            merged = true;
        }

        // Log channel IDs for debugging
        const channelIds = parsedData.channels.map(ch => ch.tvg_id).join(', ');
        logger.debug(`XMLTV channel IDs: [${channelIds}]`);
    }

    // Add programmes from XMLTV if available
    if (parsedData.programmes.length > 0) {
        // Validate that programmes reference known channels
        const channelIds = new Set(parsedData.channels.map(ch => ch.tvg_id));
        const programmeChannels = new Set(parsedData.programmes.map(p => p.channel));
        const unmatchedChannels = Array.from(programmeChannels).filter(id => !channelIds.has(id));

        if (unmatchedChannels.length > 0) {
            const shown = unmatchedChannels.slice(0, 20).join(', ');
            const more = unmatchedChannels.length > 20 ? ` and ${unmatchedChannels.length - 20} more` : '';
            logger.warn(`Found programmes for channels not in XMLTV channel list: [${shown}]${more}`);
        }

        await clearProgrammes();
        await addProgrammes(parsedData.programmes);

        // Log programme distribution per channel
        const progsByChannel = parsedData.programmes.reduce((acc, p) => {
            acc[p.channel] = (acc[p.channel] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        logger.info(`Added ${parsedData.programmes.length} programmes for ${Object.keys(progsByChannel).length} channels`);
        logger.debug(`Added programmes per channel: ${JSON.stringify(progsByChannel)}`);
    }

    // Release parsed data references
    parsedData.channels.length = 0;
    parsedData.programmes.length = 0;

    return merged;
}

/**
 * Synchronizes channels from every configured stream source (M3U playlist and/or
 * Xtream API) with the database, merging with existing XMLTV data.
 *
 * @param force - Force download even if cache exists
 */
export async function syncPlaylistChannels(force = false): Promise<void> {
    logger.debug('Initiating channel synchronization');

    const sourceChannels = await fetchSourceChannels(force);
    if (sourceChannels.length === 0) {
        logger.warn('No channels retrieved from any source; keeping existing database');
        return;
    }

    await mergeChannelsIntoDatabase(sourceChannels);
}

/**
 * Retrieves playable channels from every configured source (Xtream API and/or M3U playlist).
 *
 * @param force - Force download even if cache exists
 * @returns Channels with stream URLs (empty if every source failed)
 */
export async function fetchSourceChannels(force = false): Promise<ChannelEntry[]> {
    const sourceChannels: ChannelEntry[] = [];

    if (config.XTREAM_ENABLED) {
        try {
            for (const ch of await fetchXtreamChannels(force)) sourceChannels.push(ch);
        } catch (error) {
            logger.error(`Error retrieving Xtream channels: ${error}`);
        }
    }

    if (config.PLAYLIST) {
        for (const ch of await fetchPlaylistChannels(force)) sourceChannels.push(ch);
    }

    return sourceChannels;
}

/**
 * Downloads (or reads from cache) and parses the M3U playlist.
 *
 * @param force - Force download even if cache exists
 * @returns Parsed channel entries (empty on failure)
 */
export async function fetchPlaylistChannels(force = false): Promise<ChannelEntry[]> {
    logger.info('Retrieving playlist data...');

    let playlistContent: Buffer | null = null;

    try {
        playlistContent = await getCachedFile('playlist.m3u');
        if (playlistContent) {
            logger.debug(`Loaded cached playlist: ${playlistContent.length} bytes`);
        }
    } catch (error) {
        logger.warn(`Cache retrieval failed: ${error}`);
    }

    if (!playlistContent || force) {
        const reason = force ? 'Force refresh requested' : 'No cached data available';
        logger.info(`${reason}, fetching playlist from remote source...`);

        try {
            playlistContent = await fetchWithRetry(config.PLAYLIST, 'playlist.m3u');
            if (playlistContent) {
                logger.debug(`Successfully downloaded playlist, size: ${playlistContent.length} bytes`);
            } else {
                logger.warn('No playlist content received');
                return [];
            }
        } catch (error) {
            logger.error(`Error downloading playlist: ${error}`);
            return [];
        }
    }

    if (!playlistContent) {
        return [];
    }

    // Extract channels from playlist
    const playlistChannels: ChannelEntry[] = [];
    let currentChannel: ChannelEntry | null = null;

    // Process playlist line by line, releasing buffer
    const lines = playlistContent.toString().split('\n');
    playlistContent = null;

    for (const line of lines) {
        if (line.startsWith('#EXTINF:')) {
            currentChannel = fromPlaylistLine(line);
        } else if (currentChannel && !line.startsWith('#') && line.trim()) {
            currentChannel.url = line.trim();
            currentChannel.created_at = new Date().toISOString();
            playlistChannels.push(currentChannel);
            currentChannel = null;
        }
    }

    logger.info(`Extracted ${playlistChannels.length} channels from playlist`);

    // Log playlist channel IDs for debugging
    const playlistIds = playlistChannels.map(ch => `${ch.tvg_name}(${ch.tvg_id})`).join(', ');
    logger.debug(`Playlist channel IDs: [${playlistIds}]`);

    return playlistChannels;
}

/**
 * Merges source channels (with stream URLs) into the channels already in the database.
 * Guide-only channels (no URL) from XMLTV are kept and enriched; channels from a
 * previous sync that are no longer offered by any source are dropped, so a
 * removed channel or a narrower category filter takes effect.
 *
 * @param sourceChannels - Channels from a playlist or Xtream source
 */
export async function mergeChannelsIntoDatabase(sourceChannels: ChannelEntry[]): Promise<void> {
    const merged = mergeChannelLists(await getChannelEntries(), sourceChannels);

    if (merged.length > 0) {
        await clearChannels();
        await addChannels(merged);
        logger.info(`Synchronized ${merged.length} channels to database`);

        const finalChannelIds = merged.map(ch => `${ch.tvg_name}(${ch.tvg_id})`).join(', ');
        logger.debug(`Final database channels: [${finalChannelIds}]`);
    }
}

export { buildGuideFilter, mergeChannelLists } from './merge';
export { scheduleIPTVRefresh, stopIPTVRefresh } from './schedulers';
