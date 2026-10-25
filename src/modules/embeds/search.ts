import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { ProgrammeSearchOutcome, ProgrammeSearchResult } from '../iptv/search';

const MAX_CHANNELS_PER_RESULT = 3;
const MAX_DESCRIPTION_LENGTH = 4000;

/**
 * Formats the channels showing a programme, e.g. "Sky Sports Main Event, Sky Sports PL +2 more".
 */
function formatChannels(result: ProgrammeSearchResult): string {
    const names = result.channels.map(ch => escapeMarkdown(ch.tvg_name || ch.tvg_id || 'Unknown'));
    const shown = names.slice(0, MAX_CHANNELS_PER_RESULT).join(', ');
    const extra = names.length - MAX_CHANNELS_PER_RESULT;
    return extra > 0 ? `${shown} +${extra} more` : shown;
}

/**
 * Formats one result. Times use Discord timestamps, so each viewer sees their own time zone.
 */
function formatResult(result: ProgrammeSearchResult, index: number): string {
    const { programme } = result;
    const title = escapeMarkdown(programme.title || 'Untitled');
    const subtitle = programme.subtitle ? ` — ${escapeMarkdown(programme.subtitle)}` : '';
    const when = result.live
        ? `🔴 **Live now** · started <t:${programme.start_timestamp}:R>, ends <t:${programme.stop_timestamp}:t>`
        : `🕒 <t:${programme.start_timestamp}:f> (<t:${programme.start_timestamp}:R>)`;
    return `**${index + 1}. ${title}**${subtitle}\n${when}\n📺 ${formatChannels(result)}`;
}

/**
 * Builds the embed listing guide search results.
 *
 * @param query - What the user searched for
 * @param outcome - Search results
 * @returns Discord embed
 */
export function buildSearchEmbed(query: string, outcome: ProgrammeSearchOutcome): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(`🔎 Guide results for "${query.slice(0, 200)}"`)
        .setColor(0x5865F2)
        .setTimestamp();

    const blocks: string[] = [];
    let length = 0;
    let firstDescriptionMatch = true;
    for (const [index, result] of outcome.results.entries()) {
        let block = formatResult(result, index);
        if (result.matchedIn === 'description' && firstDescriptionMatch) {
            firstDescriptionMatch = false;
            if (index > 0) block = `*Mentioned in the description:*\n${block}`;
        }
        if (length + block.length + 2 > MAX_DESCRIPTION_LENGTH) break;
        blocks.push(block);
        length += block.length + 2;
    }
    embed.setDescription(blocks.join('\n\n'));

    const footer = outcome.total > outcome.results.length
        ? `Showing ${outcome.results.length} of ${outcome.total} matches. Add more words to narrow it down.`
        : `${outcome.total} match${outcome.total === 1 ? '' : 'es'}. Use the buttons to watch.`;
    embed.setFooter({ text: footer });

    return embed;
}
