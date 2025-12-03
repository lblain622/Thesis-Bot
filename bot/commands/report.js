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
const Vulnerability = require('../../models/Volunerabilies');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a vulnerability report'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            // Step 1: Select platform
            const platformId = await selectPlatform(interaction);
            if (!platformId) return;

            // Step 2: Select company
            const companyId = await selectCompany(interaction, platformId);
            if (!companyId) return;

            // Step 3: Select vulnerability
            const vulnerabilityId = await selectVulnerability(interaction, companyId);
            if (!vulnerabilityId) return;

            // Step 4: Confirm and submit
            const confirmed = await confirmSubmission(interaction, platformId, companyId, vulnerabilityId);
            if (!confirmed) return;

            // Step 5: Save report
            const report = await saveReport(interaction, platformId, companyId, vulnerabilityId);

            await interaction.followUp({
                content: `**Report Submitted Successfully!**\n\n` +
                    `**Report ID:** \`${report._id}\`\n` +
                    `Your report has been submitted to the company.`,
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

async function waitForSelect(message, userId, allowedCustomIds) {
    try {
        const response = await message.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
        return response;
    } catch (err) {
        return null;
    }
}

async function waitForButton(message, userId, allowedCustomIds) {
    if (typeof allowedCustomIds === 'string') {
        allowedCustomIds = [allowedCustomIds];
    }

    try {
        const response = await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
        return response;
    } catch (err) {
        return null;
    }
}

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
        content: 'Select a Platform:',
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

async function selectVulnerability(interaction, companyId) {
    const vulnerabilities = await Vulnerability.find({
        company_id: companyId,
        isResolved: false
    });

    if (!vulnerabilities.length) {
        await interaction.followUp({
            content: 'No vulnerabilities found for this company.',
            flags: 64,
        });
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_vulnerability')
        .setPlaceholder('Select a vulnerability')
        .addOptions(
            vulnerabilities.map(v => ({
                label: v.vuln_identifier,
                description: `${v.volun_type} - ${v.severity}`,
                value: v._id.toString(),
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
        content: 'Select a Vulnerability:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_vulnerability', 'back', 'close']);
    if (!response) return null;

    if (response.customId === 'back') {
        await response.update({ content: 'Returning to company selection...', components: [] });
        return await selectCompany(interaction, companyId);
    }

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Vulnerability selected.', components: [] });
    return response.values[0];
}

async function confirmSubmission(interaction, platformId, companyId, vulnerabilityId) {
    const platform = await Platform.findById(platformId);
    const company = await Company.findById(companyId);
    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    const buttons = new ActionRowBuilder().addComponents(
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
        content: `**Report Summary**\n\n` +
            `**Platform:** ${platform.name}\n` +
            `**Company:** ${company.name}\n` +
            `**Vulnerability:** ${vulnerability.vuln_identifier}\n` +
            `**Type:** ${vulnerability.volun_type}\n` +
            `**Severity:** ${vulnerability.severity}\n\n` +
            `Click **Submit Report** to confirm.`,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['submit', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Submitting report...', components: [] });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId) {
    const discordId = interaction.user.id;
    const discordName = interaction.user.username;

    let user = await User.findOne({ discord_id: discordId });
    if (!user) {
        user = await User.create({
            discord_id: discordId,
            username: discordName,
            reports_made: 0
        });
    }

    await User.updateOne(
        { _id: user._id },
        { $inc: { reports_made: 1 } }
    );

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        is_poc_only: false,
        status: 'open',
        volunerablity_sev: 'Medium' 
    };

    const report = await Reports.create(reportDoc);

    // Update vulnerability reported_by
    await Vulnerability.updateOne(
        { _id: vulnerabilityId },
        {
            $push: {
                reported_by: {
                    user_id: user._id,
                    reported_at: new Date(),
                    report_id: report._id
                }
            },
            $set: {
                isReported: true,
                reported_date: new Date()
            }
        }
    );

    return report;
}