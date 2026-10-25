import { createReadStream } from 'fs';
import type { Readable } from 'stream';
import { StringDecoder } from 'string_decoder';
import sax from 'sax';
import { getLogger } from '../../../utils/logger';
import { parseDate } from '../utils';
import type { ChannelEntry, ProgrammeEntry } from '../../../interfaces/iptv';

const logger = getLogger();

/**
 * Represents the complete parsed content from an XMLTV file
 */
export interface ParsedXMLTV {
    channels: ChannelEntry[];
    programmes: ProgrammeEntry[];
}

/**
 * Options that limit what is kept while parsing a (possibly huge) XMLTV guide.
 */
export interface XMLTVParseOptions {
    /**
     * Channel IDs and/or names to keep (matched case-insensitively against the
     * XMLTV channel id and its display names). When omitted, everything is kept.
     */
    wanted?: Set<string>;
    /** Drop programmes that ended before this Unix timestamp (seconds). */
    dropEndedBefore?: number;
    /** Drop programmes that start after this Unix timestamp (seconds). */
    dropStartingAfter?: number;
}

/**
 * Extracts complete channel and programme data from an XMLTV file.
 *
 * @param filePath - Path to the XMLTV file
 * @param options - Optional filtering
 * @returns Object containing arrays of channels and programmes
 */
export async function extractXMLTVData(filePath: string, options: XMLTVParseOptions = {}): Promise<ParsedXMLTV> {
    return parseXMLTVStream(createReadStream(filePath), options);
}

/**
 * Streams an XMLTV document and extracts channels and programmes without
 * loading the whole document into memory. Only `<channel>` and `<programme>`
 * elements directly under `<tv>` are materialised, one at a time.
 *
 * @param input - Readable stream of XMLTV data
 * @param options - Optional filtering
 * @returns Parsed channels and programmes (empty if the document is not XMLTV)
 */
export function parseXMLTVStream(input: Readable, options: XMLTVParseOptions = {}): Promise<ParsedXMLTV> {
    const output: ParsedXMLTV = { channels: [], programmes: [] };
    const wanted = options.wanted && options.wanted.size > 0
        ? new Set(Array.from(options.wanted, value => value.toLowerCase()))
        : undefined;
    const keptChannelIds = new Set<string>();
    const channelNameMap = new Map<string, string>();

    let seenTv = false;
    let seenChannels = 0;
    let seenProgrammes = 0;
    let failedProgrammes = 0;

    // Stack of xml2js-shaped nodes for the element currently being built.
    type Node = { name: string; attrs: Record<string, string>; text: string; children: Record<string, any[]> };
    const stack: Node[] = [];
    let depth = 0;

    const toXml2js = (node: Node): any => {
        const hasAttrs = Object.keys(node.attrs).length > 0;
        const hasChildren = Object.keys(node.children).length > 0;
        const text = node.text.trim();
        if (!hasAttrs && !hasChildren) {
            return text;
        }
        const obj: any = { ...node.children };
        if (hasAttrs) obj.$ = node.attrs;
        if (text) obj._ = text;
        return obj;
    };

    const handleChannel = (channelNode: any) => {
        seenChannels++;
        try {
            const channel = extractChannelData(channelNode);
            if (wanted) {
                const names = (channelNode['display-name'] || []).map((n: any) => extractTextContent(n).toLowerCase());
                const match = wanted.has((channel.tvg_id || '').toLowerCase()) || names.some((n: string) => wanted.has(n));
                if (!match) return;
            }
            output.channels.push(channel);
            if (channel.tvg_id) {
                keptChannelIds.add(channel.tvg_id.toLowerCase());
                if (channel.tvg_name) channelNameMap.set(channel.tvg_id, channel.tvg_name);
            }
        } catch (err) {
            const channelId = channelNode.$?.id || 'unknown';
            logger.error(`Channel extraction failed for "${channelId}": ${err}`);
        }
    };

    const handleProgramme = (programmeNode: any) => {
        seenProgrammes++;
        const channelId = String(programmeNode.$?.channel || '').toLowerCase();
        if (wanted && !keptChannelIds.has(channelId) && !wanted.has(channelId)) {
            return;
        }
        try {
            const programme = buildProgrammeEntry(programmeNode, channelNameMap);
            if (options.dropEndedBefore !== undefined && programme.stop_timestamp < options.dropEndedBefore) {
                return;
            }
            if (options.dropStartingAfter !== undefined && programme.start_timestamp > options.dropStartingAfter) {
                return;
            }
            output.programmes.push(programme);
        } catch (err) {
            failedProgrammes++;
            const programmeTitle = extractTextContent(programmeNode['title']?.[0]) || 'unknown';
            logger.debug(`Programme extraction failed for "${programmeTitle}": ${err}`);
        }
    };

    return new Promise(resolve => {
        const parser = sax.createStream(true, { trim: false });
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            if (!ok || !seenTv) {
                if (ok) logger.error('Invalid XMLTV structure detected');
                resolve({ channels: [], programmes: [] });
                return;
            }
            try {
                logger.info(`Kept ${output.channels.length} of ${seenChannels} XMLTV channels and ${output.programmes.length} of ${seenProgrammes} programmes`);
                if (failedProgrammes > 0) {
                    logger.warn(`Skipped ${failedProgrammes} malformed programme entries`);
                }
                if (output.programmes.length > 0) {
                    logProgrammeStatistics(output.programmes);
                }
            } catch (err) {
                logger.warn(`Could not log XMLTV statistics: ${err}`);
            }
            resolve(output);
        };

        parser.on('opentag', tag => {
            depth++;
            if (depth === 1) {
                seenTv = tag.name === 'tv';
                return;
            }
            if (!seenTv) return;
            if (depth === 2 && tag.name !== 'channel' && tag.name !== 'programme') return;
            if (depth > 2 && stack.length === 0) return;
            stack.push({ name: tag.name, attrs: { ...(tag.attributes as Record<string, string>) }, text: '', children: {} });
        });

        const onText = (text: string) => {
            const node = stack[stack.length - 1];
            if (node) node.text += text;
        };
        parser.on('text', onText);
        parser.on('cdata', onText);

        parser.on('closetag', () => {
            depth--;
            if (stack.length === 0) return;
            const node = stack.pop()!;
            const value = toXml2js(node);
            const parent = stack[stack.length - 1];
            if (parent) {
                (parent.children[node.name] ||= []).push(value);
                return;
            }
            // Top-level element finished. Ensure the node keeps xml2js object shape.
            const element = typeof value === 'string' ? { $: node.attrs } : value;
            if (node.name === 'channel') handleChannel(element);
            else handleProgramme(element);
        });

        // Real-world guides often contain small errors (e.g. an unescaped "&").
        // Skip past them instead of discarding the whole guide, but give up on
        // input that is clearly not XML.
        let xmlErrors = 0;
        parser.on('error', err => {
            xmlErrors++;
            if (xmlErrors === 1) {
                logger.warn(`XMLTV contains malformed XML, skipping bad sections: ${err.message.split('\n')[0]}`);
            }
            // sax clears the error after emitting it, so parsing simply continues.
            if (xmlErrors > 1000) {
                logger.error(`XML parsing failed after ${xmlErrors} errors: ${err.message.split('\n')[0]}`);
                input.destroy();
                finish(false);
            }
        });
        parser.on('end', () => finish(true));
        input.on('error', err => {
            logger.error(`XMLTV stream error: ${err.message}`);
            finish(false);
        });

        // Feed the parser manually: piping would unpipe on the first XML error.
        // A StringDecoder keeps multi-byte UTF-8 characters intact across chunk boundaries.
        const decoder = new StringDecoder('utf8');
        input.on('data', chunk => {
            if (!settled) parser.write(typeof chunk === 'string' ? chunk : decoder.write(chunk));
        });
        input.on('end', () => {
            if (settled) return;
            const rest = decoder.end();
            if (rest) parser.write(rest);
            parser.end();
        });
    });
}

/**
 * Extracts and structures channel data from raw XMLTV channel element.
 * 
 * @param channel - Raw channel data from XMLTV
 * @returns Structured channel entry
 */
function extractChannelData(channel: any): ChannelEntry {
    const channelId = channel.$.id;
    let channelName = '';
    let channelNum = '';

    // Extract channel name and number from display-name elements
    if (channel['display-name'] && Array.isArray(channel['display-name'])) {
        for (const nameElement of channel['display-name']) {
            const displayName = extractTextContent(nameElement);

            // Identify numeric-only display names as channel numbers
            if (/^\d+$/.test(displayName) && !channelNum) {
                channelNum = displayName;
            }
            // Use first non-numeric display name as primary channel name
            // This prevents "1 One Piece" format from being used when "One Piece" is available
            else if (!channelName || /^\d+\s/.test(channelName)) {
                channelName = displayName;
            }
        }
    }

    // Extract icon URL from channel metadata
    const iconUrl = channel['icon']?.[0]?.$?.src || '';

    logger.debug(`Extracted channel: ${channelId} -> ${channelName}`);

    return {
        xui_id: parseInt(channelNum) || 0,
        tvg_id: channelId,
        tvg_name: channelName,
        tvg_logo: iconUrl,
        group_title: '',
        url: '',
        created_at: new Date().toISOString(),
    };
}

/**
 * Builds a structured programme entry from raw XMLTV programme data.
 * 
 * @param programme - Raw programme data from XMLTV
 * @param channelNameMap - Map of channel IDs to names for title cleanup
 * @returns Structured programme entry
 * @throws Error if programme is missing required fields
 */
function buildProgrammeEntry(programme: any, channelNameMap: Map<string, string>): ProgrammeEntry {
    // Extract text content fields
    let title = extractTextContent(programme['title']?.[0]);

    // Strip duplicate channel name prefix if present (e.g., "One Piece: One Piece: The Movie" -> "One Piece: The Movie")
    const channelId = programme.$.channel;
    const channelName = channelNameMap.get(channelId);
    if (channelName && title.startsWith(`${channelName}: `)) {
        title = title.substring(channelName.length + 2);
    }
    const description = extractTextContent(programme['desc']?.[0]);
    const category = extractTextContent(programme['category']?.[0]);
    const subtitle = extractTextContent(programme['sub-title']?.[0]);
    const airDate = extractTextContent(programme['date']?.[0]);
    const image = extractTextContent(programme['image']?.[0]);

    // Extract structured data
    const episodeInfo = extractEpisodeInfo(programme['episode-num']);
    const icon = programme['icon']?.[0]?.$?.src || '';
    const isRerun = programme['previously-shown'] !== undefined;

    // Extract timing information
    const startStr = programme.$.start;
    const stopStr = programme.$.stop;

    if (!startStr || !stopStr) {
        throw new Error(`Programme missing required start/stop times: ${title}`);
    }

    logger.debug(`Building programme entry "${title}" [${startStr} - ${stopStr}]`);

    const start = parseDate(startStr);
    const stop = parseDate(stopStr);

    if (start.getTime() === stop.getTime()) {
        logger.warn(`Programme "${title}" has identical start and stop times: ${startStr}`);
    }

    return {
        start: start.toISOString(),
        stop: stop.toISOString(),
        start_timestamp: Math.floor(start.getTime() / 1000),
        stop_timestamp: Math.floor(stop.getTime() / 1000),
        channel: programme.$.channel,
        title,
        description,
        category,
        subtitle,
        episode_num: episodeInfo.episodeNum,
        season: episodeInfo.season,
        episode: episodeInfo.episode,
        icon,
        image,
        date: airDate,
        previously_shown: isRerun,
        created_at: new Date().toISOString(),
    };
}

/**
 * Extracts text content from an XMLTV element.
 * Handles both string values and structured objects with underscore property.
 * 
 * @param element - XML element that may contain text
 * @returns Extracted text or empty string if not found
 */
function extractTextContent(element: any): string {
    if (!element) {
        return '';
    }

    if (typeof element === 'string') {
        return element;
    } else if (element._) {
        return element._;
    }

    return '';
}

/**
 * Extracts episode information from XMLTV episode-num elements.
 * Handles xmltv_ns format (season.episode.part) with 0-based to 1-based conversion.
 * 
 * @param episodeElements - Array of episode-num elements
 * @returns Object with episode number string and optional season/episode numbers
 */
function extractEpisodeInfo(episodeElements: any[]): {
    episodeNum: string;
    season: number | undefined;
    episode: number | undefined;
} {
    let episodeNum = '';
    let season: number | undefined;
    let episode: number | undefined;

    if (episodeElements && Array.isArray(episodeElements)) {
        for (const element of episodeElements) {
            const system = element.$?.system;
            const rawValue = extractTextContent(element);

            if (rawValue) {
                episodeNum = rawValue;

                // Process xmltv_ns format: "season.episode.part"
                if (system === 'xmltv_ns') {
                    const segments = rawValue.split('.');
                    if (segments.length >= 2 && segments[0] && segments[1]) {
                        const seasonIndex = parseInt(segments[0]);
                        const episodeIndex = parseInt(segments[1]);

                        // Convert from 0-based to 1-based indexing
                        if (!isNaN(seasonIndex)) season = seasonIndex + 1;
                        if (!isNaN(episodeIndex)) episode = episodeIndex + 1;
                    }
                }
            }
        }
    }

    return { episodeNum, season, episode };
}

/**
 * Logs statistics about the parsed programme data.
 * Includes total count, channel count, and date range.
 * 
 * @param programmes - Array of programme entries
 */
function logProgrammeStatistics(programmes: ProgrammeEntry[]): void {
    // Add summary statistics
    const channels = new Set(programmes.map(p => p.channel)).size;
    logger.info(`Parsed ${programmes.length} programmes across ${channels} channels from XMLTV file`);

    // Check for date range in the data
    if (programmes.length > 0) {
        // Loop instead of Math.min(...array): spreading hundreds of thousands
        // of values overflows the call stack.
        let min = Infinity;
        let max = -Infinity;
        for (const p of programmes) {
            const t = p.start_timestamp;
            if (t < min) min = t;
            if (t > max) max = t;
        }
        const minDate = new Date(min * 1000);
        const maxDate = new Date(max * 1000);
        logger.info(`Programme date range: ${minDate.toISOString()} to ${maxDate.toISOString()}`);
    }
}
