import { createHash } from 'crypto';
import type { ChannelEntry } from '../interfaces/iptv';

/**
 * Sanitizes a channel name so it can be safely embedded in a Discord
 * component custom ID. Discord limits custom IDs to 100 characters, and
 * arbitrary characters are not allowed.
 *
 * Sanitization is intentionally lossy; use {@link findChannelBySanitizedId}
 * to resolve an ID back to a channel.
 *
 * @param name - Channel name to sanitize
 * @returns A safe custom ID fragment of at most 80 characters
 */
export function sanitizeChannelId(name: string): string {
    return name.replace(/[^\w-]/g, '_').slice(0, 80);
}

/**
 * Finds a channel whose name sanitizes to the provided custom ID value.
 *
 * @param channels - Channels to search
 * @param sanitizedId - The custom ID fragment produced by {@link sanitizeChannelId}
 * @returns The matching channel, or undefined if none matches
 */
export function findChannelBySanitizedId(channels: ChannelEntry[], sanitizedId: string): ChannelEntry | undefined {
    return channels.find(channel => channelKey(channel) === sanitizedId)
        ?? channels.find(channel =>
            channel.tvg_name !== undefined && sanitizeChannelId(channel.tvg_name) === sanitizedId
        );
}

/**
 * A short, stable identifier for a channel, derived from its stream URL (or
 * its EPG id / name when it has none). Unlike the name it is unique when
 * several channels share a name (e.g. "AMC" in US, CA and EU categories), and
 * it survives refreshes as long as the stream URL stays the same. Safe to use
 * in Discord custom IDs and autocomplete values.
 *
 * @param channel - Channel to identify
 * @returns Identifier such as "c3f9a1b2c4d5"
 */
export function channelKey(channel: ChannelEntry): string {
    const source = channel.url || `epg:${channel.tvg_id ?? ''}` || `name:${channel.tvg_name ?? ''}`;
    return 'c' + createHash('sha1').update(source).digest('hex').slice(0, 11);
}

/**
 * Resolves what a user picked or typed to a channel: an identifier from
 * {@link channelKey} (autocomplete and buttons) or a channel name, matched
 * case-insensitively. With duplicate names, the first channel wins.
 *
 * @param channels - Channels to search
 * @param ref - Channel identifier or name
 * @returns The matching channel, or undefined
 */
export function findChannel(channels: ChannelEntry[], ref: string): ChannelEntry | undefined {
    const wanted = ref.trim();
    if (!wanted) return undefined;
    const lower = wanted.toLowerCase();
    return channels.find(channel => channelKey(channel) === wanted)
        ?? channels.find(channel => channel.tvg_name?.toLowerCase() === lower);
}

/**
 * Builds autocomplete choices labelled "Channel | Category". The value is the
 * channel's {@link channelKey}, so same-named channels stay distinct.
 * Channels whose name matches the typed text come first, then channels whose
 * category matches.
 *
 * @param channels - Channels to choose from
 * @param query - Text the user has typed so far
 * @param limit - Maximum choices (Discord allows 25)
 * @returns Choices for `interaction.respond`
 */
export function buildChannelChoices(channels: ChannelEntry[], query: string, limit = 25): { name: string; value: string }[] {
    const text = query.trim().toLowerCase();
    const byName: ChannelEntry[] = [];
    const byCategory: ChannelEntry[] = [];
    for (const channel of channels) {
        if (!channel.tvg_name) continue;
        if (channel.tvg_name.toLowerCase().includes(text)) byName.push(channel);
        else if (text && channel.group_title?.toLowerCase().includes(text)) byCategory.push(channel);
    }

    const seen = new Set<string>();
    const choices: { name: string; value: string }[] = [];
    for (const channel of [...byName, ...byCategory]) {
        const value = channelKey(channel);
        if (seen.has(value)) continue;
        seen.add(value);
        choices.push({ name: formatChannelLabel(channel.tvg_name!, channel.group_title), value });
        if (choices.length >= limit) break;
    }
    return choices;
}

/**
 * Formats "Channel | Category" within Discord's 100-character limit,
 * shortening the channel name first so the category stays readable.
 */
function formatChannelLabel(name: string, category?: string): string {
    const group = category?.trim();
    if (!group) return name.slice(0, 100);
    const suffix = ` | ${group}`.slice(0, 50);
    const room = 100 - suffix.length;
    const shown = name.length > room ? `${name.slice(0, room - 1)}…` : name;
    return `${shown}${suffix}`;
}

/**
 * A channel's name with its category, e.g. "AMC (US | Entertainment)", so
 * same-named channels can be told apart in lists and buttons.
 *
 * @param channel - Channel to describe
 * @returns Display name
 */
export function channelDisplayName(channel: ChannelEntry): string {
    const name = channel.tvg_name || channel.tvg_id || 'Unknown';
    const group = channel.group_title?.trim();
    return group ? `${name} (${group})` : name;
}
