const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');
const Reports = require('../../models/Reports');
const User = require('../../models/Users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a vulnerability report to a company'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const platformId = await selectPlatform(interaction);
            if (!platformId) return;

            const companyId = await selectCompany(interaction, platformId);
            if (!companyId) return;

            const severity = await selectSeverity(interaction);
            if (!severity) return;

            // Get platform and company names for summary
            const platform = await Platform.findById(platformId);
            const company = await Company.findById(companyId);

            const submitted = await showSummary(interaction, platform, company, severity);
            if (!submitted) return;

            const report = await saveReport(
                interaction,
                platformId,
                companyId,
                severity,
                "No description provided" // Default description
            );

            await interaction.followUp({
                content: `**Report Submitted Successfully!**\n\n**Platform:** ${platform.name}\n**Company:** ${company.name}\n**Severity:** ${severity.toUpperCase()}\n**Report ID:** \`${report._id}\``,
                flags: 64,
            });
        } catch (err) {
            console.error(err);
            await interaction.followUp({
                content: 'An error occurred while submitting your report.',
                flags: 64,
            });
        }
    },
};

async function selectPlatform(interaction) {
    const platforms = await Platform.find({});
    if (!platforms.length) {
        await interaction.editReply('No platforms found in the database.');
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_platform')
        .setPlaceholder('Select a Platform')
        .addOptions(
            platforms.map(p => ({
                label: p.name,
                description: p.description?.slice(0, 80) || 'No description',
                value: p._id.toString(),
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Platform to report under:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_platform', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Platform selected.', components: [] });
    return response.values[0];
}

async function selectCompany(interaction, platformId) {
    const companies = await Company.find({ platform_id: platformId });
    if (!companies.length) {
        await interaction.followUp({
            content: 'No companies found for that platform.',
            flags: 64,
        });
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_company')
        .setPlaceholder('Select a Company')
        .addOptions(
            companies.map(c => ({
                label: c.name,
                description: c.description?.slice(0, 80) || 'No description',
                value: c._id.toString(),
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Company:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_company', 'back', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to platform selection...', components: [] });
        return await selectPlatform(interaction);
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Company selected.', components: [] });
    return response.values[0];
}

async function selectSeverity(interaction) {
    const severities = [
        { label: 'Low', value: 'low', description: 'Minor issue' },
        { label: 'Medium', value: 'medium', description: 'Moderate issue' },
        { label: 'High', value: 'high', description: 'Severe issue' },
        { label: 'Critical', value: 'critical', description: 'Extremely severe' },
    ];

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_severity')
        .setPlaceholder('Select Severity Level')
        .addOptions(severities);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select the Severity level:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_severity', 'back', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to company selection...', components: [] });
        return await selectCompany(interaction, response.values[0]);
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({
        content: `Severity selected: ${response.values[0].toUpperCase()}`,
        components: [],
    });

    return response.values[0];
}

async function showSummary(interaction, platform, company, severity) {
    const summaryContent = `
**📋 Report Summary**

**Platform:** ${platform.name}
**Company:** ${company.name}
**Severity:** ${severity.toUpperCase()}

Please review your report and click **Submit** to finalize.
    `.trim();

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('back')
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId('submit')
            .setLabel('Submit Report')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: summaryContent,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['back', 'submit', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to severity selection...', components: [] });
        return await selectSeverity(interaction);
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    if (response.customId === 'submit') {
        await response.update({
            content: 'Submitting your report...',
            components: []
        });
        return true;
    }

    return null;
}

async function saveReport(interaction, platformId, companyId, severity, description) {
    const discordId = interaction.user.id;
    const discordName = interaction.user.username;
    let user = await User.findOne({ discord_id: discordId });
    if (!user) user = await User.create({ discord_id: discordId, discord_name: discordName });

    return await Reports.create({
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        volunerablity_sev: severity,
        description,
    });
}

async function waitForSelect(message, userId, customIds) {
    try {
        return await message.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => {
                const isCorrectUser = i.user.id === userId;
                const isCorrectComponent = Array.isArray(customIds)
                    ? customIds.includes(i.customId)
                    : i.customId === customIds;
                return isCorrectUser && isCorrectComponent;
            },
            time: 120_000
        });
    } catch (error) {
        console.error('Error in waitForSelect:', error);
        await message.edit({
            content: 'Selection timed out or encountered an error.',
            components: []
        }).catch(console.error);
        return null;
    }
}

async function waitForButton(message, userId, customIds) {
    try {
        return await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: i => {
                const isCorrectUser = i.user.id === userId;
                const isCorrectComponent = Array.isArray(customIds)
                    ? customIds.includes(i.customId)
                    : i.customId === customIds;
                return isCorrectUser && isCorrectComponent;
            },
            time: 120_000
        });
    } catch (error) {
        console.error('Error in waitForButton:', error);
        await message.edit({
            content: 'Selection timed out or encountered an error.',
            components: []
        }).catch(console.error);
        return null;
    }
}
