import type { ChannelEntry } from '../../interfaces/iptv';

/**
 * Builds the set of channel IDs and names the guide should be filtered to.
 *
 * @param channels - Playable channels
 * @returns Lower-cased tvg_ids and names, or undefined when there is nothing to filter by
 */
export function buildGuideFilter(channels: ChannelEntry[]): Set<string> | undefined {
    const wanted = new Set<string>();
    for (const channel of channels) {
        if (channel.tvg_id) wanted.add(channel.tvg_id.toLowerCase());
        if (channel.tvg_name) wanted.add(channel.tvg_name.toLowerCase());
    }
    return wanted.size > 0 ? wanted : undefined;
}

/**
 * Pure merge of database channels with source channels (see mergeChannelsIntoDatabase).
 * Each source channel is matched to at most one guide channel, by name first,
 * then by tvg_id; each guide channel is claimed at most once. Source channels
 * that share a name (e.g. "AMC" in US, CA and EU categories) all stay as
 * separate entries; only exact duplicate stream URLs are dropped.
 *
 * @param existingChannels - Channels currently in the database
 * @param sourceChannels - Channels from a playlist or Xtream source
 * @returns Merged channel list
 */
export function mergeChannelLists(existingChannels: ChannelEntry[], sourceChannels: ChannelEntry[]): ChannelEntry[] {
    // Only guide-only channels carry over; previously synced channels are rebuilt from the sources.
    const guideChannels = existingChannels.filter(ch => !ch.url).map(ch => ({ ...ch }));
    const unclaimedByName = new Map<string, ChannelEntry>();
    const unclaimedById = new Map<string, ChannelEntry>();
    for (const ch of guideChannels) {
        const name = ch.tvg_name?.toLowerCase();
        if (name && !unclaimedByName.has(name)) unclaimedByName.set(name, ch);
        const id = ch.tvg_id?.toLowerCase();
        if (id && !unclaimedById.has(id)) unclaimedById.set(id, ch);
    }

    const claim = (ch: ChannelEntry) => {
        const name = ch.tvg_name?.toLowerCase();
        if (name && unclaimedByName.get(name) === ch) unclaimedByName.delete(name);
        const id = ch.tvg_id?.toLowerCase();
        if (id && unclaimedById.get(id) === ch) unclaimedById.delete(id);
    };

    const merged: ChannelEntry[] = [...guideChannels];
    const seenUrls = new Set<string>();

    for (const sourceCh of sourceChannels) {
        if (sourceCh.url) {
            if (seenUrls.has(sourceCh.url)) continue;
            seenUrls.add(sourceCh.url);
        }

        let target = sourceCh.tvg_name ? unclaimedByName.get(sourceCh.tvg_name.toLowerCase()) : undefined;
        if (!target && sourceCh.tvg_id) {
            target = unclaimedById.get(sourceCh.tvg_id.toLowerCase());
            if (target) {
                // Adopt the provider's channel name so it matches what users search for.
                target.tvg_name = sourceCh.tvg_name || target.tvg_name;
            }
        }

        if (target) {
            claim(target);
            target.url = sourceCh.url;
            if (sourceCh.group_title) target.group_title = sourceCh.group_title;
            if (sourceCh.tvg_logo) target.tvg_logo = sourceCh.tvg_logo;
            if (sourceCh.tvg_id) target.tvg_id = sourceCh.tvg_id;
            if (sourceCh.xui_id) target.xui_id = sourceCh.xui_id;
            if (sourceCh.country) target.country = sourceCh.country;
            if (sourceCh.created_at) target.created_at = sourceCh.created_at;
        } else {
            merged.push({ ...sourceCh });
        }
    }

    return merged;
}
