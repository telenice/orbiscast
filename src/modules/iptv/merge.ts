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
 * Source channels are matched to guide channels by name first, then by tvg_id
 * (each guide channel is claimed at most once, so several source variants that
 * share an EPG id, e.g. "BBC One HD" and "BBC One SD", all survive).
 *
 * @param existingChannels - Channels currently in the database
 * @param sourceChannels - Channels from a playlist or Xtream source
 * @returns Merged channel list
 */
export function mergeChannelLists(existingChannels: ChannelEntry[], sourceChannels: ChannelEntry[]): ChannelEntry[] {
    // Only guide-only channels carry over; previously synced channels are rebuilt from the sources.
    const guideChannels = existingChannels.filter(ch => !ch.url).map(ch => ({ ...ch }));
    const byName = new Map<string, ChannelEntry>();
    const unclaimedById = new Map<string, ChannelEntry>();
    for (const ch of guideChannels) {
        const key = ch.tvg_name || ch.tvg_id;
        if (key) byName.set(key, ch);
        if (ch.tvg_id) unclaimedById.set(ch.tvg_id.toLowerCase(), ch);
    }

    sourceChannels.forEach((sourceCh, index) => {
        const channelKey = sourceCh.tvg_name || sourceCh.tvg_id || `playlist_${index}`;
        let target = byName.get(channelKey);

        if (!target && sourceCh.tvg_id) {
            const byId = unclaimedById.get(sourceCh.tvg_id.toLowerCase());
            if (byId) {
                // Adopt the provider's channel name so it matches what users search for.
                byName.delete(byId.tvg_name || byId.tvg_id || '');
                byId.tvg_name = sourceCh.tvg_name || byId.tvg_name;
                byName.set(channelKey, byId);
                target = byId;
            }
        }

        if (target) {
            if (target.tvg_id) unclaimedById.delete(target.tvg_id.toLowerCase());
            target.url = sourceCh.url;
            if (sourceCh.group_title) target.group_title = sourceCh.group_title;
            if (sourceCh.tvg_logo) target.tvg_logo = sourceCh.tvg_logo;
            if (sourceCh.tvg_id) target.tvg_id = sourceCh.tvg_id;
            if (sourceCh.xui_id) target.xui_id = sourceCh.xui_id;
            if (sourceCh.country) target.country = sourceCh.country;
            if (sourceCh.created_at) target.created_at = sourceCh.created_at;
        } else {
            byName.set(channelKey, { ...sourceCh });
        }
    });

    return Array.from(byName.values());
}
