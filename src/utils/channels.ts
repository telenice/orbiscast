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
    return channels.find(channel =>
        channel.tvg_name !== undefined && sanitizeChannelId(channel.tvg_name) === sanitizedId
    );
}

/**
 * Builds autocomplete choices labelled "Channel | Category". The value stays
 * the plain channel name so commands keep resolving channels by name.
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
        const value = channel.tvg_name!.slice(0, 100);
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
