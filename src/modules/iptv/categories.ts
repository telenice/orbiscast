import type { ChannelEntry } from '../../interfaces/iptv';

/**
 * Parses a comma-separated list of category patterns (case-insensitive).
 * `*` matches any run of characters, so `*4K*` matches "UK | 4K" and "4K UHD".
 *
 * @param value - Raw pattern list, e.g. "UK | 4K,*Adult*"
 * @returns Regular expressions matching whole category names
 */
export function parseCategoryPatterns(value: string | undefined): RegExp[] {
    return (value || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
        .map(entry => {
            const source = entry.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
            return new RegExp(`^${source}$`, 'i');
        });
}

/**
 * Whether a category name matches any of the patterns.
 *
 * @param category - Category name (group-title)
 * @param patterns - Patterns from {@link parseCategoryPatterns}
 * @returns True if the category matches
 */
export function matchesCategory(category: string | undefined, patterns: RegExp[]): boolean {
    const name = category?.trim() || '';
    return Boolean(name) && patterns.some(pattern => pattern.test(name));
}

/**
 * Removes channels whose category matches any of the patterns.
 *
 * @param channels - Channels from a playlist or Xtream source
 * @param patterns - Patterns from {@link parseCategoryPatterns}; empty keeps everything
 * @returns Channels outside the excluded categories
 */
export function excludeCategories(channels: ChannelEntry[], patterns: RegExp[]): ChannelEntry[] {
    if (patterns.length === 0) return channels;
    return channels.filter(channel => !matchesCategory(channel.group_title, patterns));
}
