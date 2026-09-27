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
