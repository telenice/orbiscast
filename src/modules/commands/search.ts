import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, GuildMember, MessageFlags } from 'discord.js';
import { getLogger } from '../../utils/logger';
import { getChannelEntries, getProgrammeEntries } from '../database';
import { findChannelBySanitizedId, sanitizeChannelId } from '../../utils/channels';
import { searchProgrammes } from '../iptv/search';
import type { ProgrammeSearchResult } from '../iptv/search';
import { buildSearchEmbed } from '../embeds/search';
import { executeStreamChannel } from './stream';

const logger = getLogger();
const PLAY_PREFIX = 'search_play_';
const MAX_RESULTS = 10;

/**
 * Builds one "watch" button per result (first channel showing it).
 * Custom IDs include the result index so two results on one channel stay unique.
 */
export function buildSearchButtons(results: ProgrammeSearchResult[]): ActionRowBuilder<ButtonBuilder>[] {
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    let row = new ActionRowBuilder<ButtonBuilder>();

    results.forEach((result, index) => {
        const channel = result.channels[0];
        if (!channel?.tvg_name) return;

        const label = `${index + 1}. ${result.live ? '🔴' : '▶'} ${channel.tvg_name}`.slice(0, 80);
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${PLAY_PREFIX}${index}_${sanitizeChannelId(channel.tvg_name)}`)
                .setLabel(label)
                .setStyle(result.live ? ButtonStyle.Danger : ButtonStyle.Secondary)
        );
        if (row.components.length === 5) {
            rows.push(row);
            row = new ActionRowBuilder<ButtonBuilder>();
        }
    });
    if (row.components.length > 0) rows.push(row);

    return rows.slice(0, 5);
}

/**
 * Starts the channel behind a search result button.
 */
async function handlePlayButton(interaction: ButtonInteraction): Promise<void> {
    const sanitizedId = interaction.customId.slice(PLAY_PREFIX.length).replace(/^\d+_/, '');
    const channel = findChannelBySanitizedId(await getChannelEntries(), sanitizedId);

    if (!channel?.tvg_name) {
        await interaction.followUp({ content: 'Could not find that channel any more. Try searching again.', flags: MessageFlags.Ephemeral });
        return;
    }

    const voiceChannel = (interaction.member as GuildMember | null)?.voice?.channel;
    if (!voiceChannel) {
        await interaction.followUp({ content: 'Join a voice channel first, then press the button again.', flags: MessageFlags.Ephemeral });
        return;
    }

    logger.info(`Search result button: streaming ${channel.tvg_name} for ${interaction.user.tag}`);
    const result = await executeStreamChannel(channel.tvg_name, voiceChannel.id);

    const reply = await interaction.followUp({
        content: result.message || undefined,
        embeds: result.embed ? [result.embed] : [],
        components: result.components || [],
        flags: MessageFlags.Ephemeral,
    });
    if (result.success && result.setupCollector) {
        result.setupCollector(reply);
    }
}

/**
 * Handles the /search command: finds guide entries (e.g. "liverpool") and
 * lists when and on which channels they are on, with buttons to watch.
 *
 * @param interaction - The Discord command interaction
 */
export async function handleSearchCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const query = interaction.options.getString('query', true).trim();
    const programmes = await getProgrammeEntries();

    if (programmes.length === 0) {
        await interaction.editReply('No guide data is loaded, so there is nothing to search. Set up an XMLTV guide (or the Xtream EPG) first.');
        return;
    }

    const outcome = searchProgrammes(programmes, await getChannelEntries(), query, Math.floor(Date.now() / 1000), MAX_RESULTS);
    logger.info(`Guide search "${query}" by ${interaction.user.tag}: ${outcome.total} matches`);

    if (outcome.total === 0) {
        await interaction.editReply(`Nothing in the guide matches "${query}". Try fewer or different words (e.g. a team name only).`);
        return;
    }

    const message = await interaction.editReply({
        embeds: [buildSearchEmbed(query, outcome)],
        components: buildSearchButtons(outcome.results),
    });

    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 10 * 60 * 1000,
    });

    collector.on('collect', async (buttonInteraction) => {
        if (!buttonInteraction.customId.startsWith(PLAY_PREFIX)) return;
        try {
            await buttonInteraction.deferUpdate();
            await handlePlayButton(buttonInteraction);
        } catch (error) {
            logger.error(`Error handling search button: ${error}`);
            await buttonInteraction.followUp({ content: 'Something went wrong starting that channel.', flags: MessageFlags.Ephemeral }).catch(() => { });
        }
    });

    collector.on('end', () => {
        interaction.editReply({ components: [] }).catch(() => { });
    });
}
