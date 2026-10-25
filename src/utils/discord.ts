import { Client, GatewayIntentBits, GuildMember, Partials, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { getLogger } from './logger';
import { config } from './config';
import { getChannelEntries } from '../modules/database';
import { buildChannelChoices } from './channels';
import { handleStreamCommand, handleStopCommand, handleListCommand, handleRefreshCommand, handleProgrammeCommand, handleSearchCommand } from '../modules/commands';

const logger = getLogger();

/**
 * Discord client instance with configured intents and partials
 */
export const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.Channel],
});

client.once('clientReady', async () => {
    logger.info(`OrbisCast connected as ${client.user?.tag}`);
    logger.info(`Attempting to connect to GUILD ID: ${config.GUILD}`);

    const guild = client.guilds.cache.get(config.GUILD);
    if (!guild) {
        logger.error(`Guild ${config.GUILD} not found`);
        logger.info('Connected to the following guilds:');
        client.guilds.cache.forEach(guild => {
            logger.info(`- ${guild.name} (${guild.id})`);
        });
        return;
    }

    logger.info(`Connected to guild: ${guild.name}`);

    const rest = new REST({ version: '10' }).setToken(config.DISCORD_BOT_TOKEN);
    const commands = [
        new SlashCommandBuilder().setName('stream').setDescription('Stream an IPTV channel')
            .addStringOption(option => option.setName('channel').setDescription('The IPTV channel to stream').setAutocomplete(true)),
        new SlashCommandBuilder().setName('stop').setDescription('Stop streaming the IPTV channel'),
        new SlashCommandBuilder().setName('channels').setDescription('List all IPTV channels')
            .addStringOption(option => option.setName('page').setDescription('Page number to display or "all" to list all channels')),
        new SlashCommandBuilder().setName('refresh').setDescription('Refresh the specified data')
            .addStringOption(option => option.setName('type').setDescription('The type of data to refresh').setRequired(true)
                .addChoices(
                    { name: 'all', value: 'all' },
                    { name: 'channels', value: 'channels' },
                    { name: 'programme', value: 'programme' }
                )),
        new SlashCommandBuilder().setName('programme').setDescription('Show programme guide for a channel')
            .addStringOption(option => option.setName('channel').setDescription('The channel name').setAutocomplete(true).setRequired(false)),
        new SlashCommandBuilder().setName('search').setDescription('Search the TV guide for a programme, team or event')
            .addStringOption(option => option.setName('query').setDescription('What to look for, e.g. "liverpool"').setRequired(true).setMinLength(2).setMaxLength(100)),
    ].map(command => command.toJSON());

    try {
        await rest.put(Routes.applicationGuildCommands(client.user!.id, guild.id), { body: commands });
        logger.info('Successfully registered application commands.');
    } catch (error) {
        logger.error(`Error registering application commands: ${error}`);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;
        const options = interaction.options.data.map((option: any) => ({
            name: option.name,
            value: option.value
        }));
        logger.info(`Received command: ${commandName} with options: ${JSON.stringify(options)} from ${interaction.user.tag}`);
        if (commandName === 'stream') {
            await handleStreamCommand(interaction);
        } else if (commandName === 'stop') {
            await handleStopCommand(interaction);
        } else if (commandName === 'channels') {
            await handleListCommand(interaction);
        } else if (commandName === 'refresh') {
            await handleRefreshCommand(interaction);
        } else if (commandName === 'programme') {
            await handleProgrammeCommand(interaction);
        } else if (commandName === 'search') {
            await handleSearchCommand(interaction);
        }
    } else if (interaction.isAutocomplete()) {
        const { commandName, options } = interaction;

        if (commandName === 'stream' || commandName === 'programme') {
            const current = options.getFocused() ?? '';
            const channelEntries = await getChannelEntries();

            // Discord allows at most 25 autocomplete choices and caps names at
            // 100 characters. Always respond (even when empty) so the client
            // does not time out waiting for the interaction to be acknowledged.
            await interaction.respond(buildChannelChoices(channelEntries, current));
        }
    }
});

client.on('error', error => {
    logger.error(`Discord client error: ${error}`);
});
