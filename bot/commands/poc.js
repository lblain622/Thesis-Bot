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
const Vulnerability = require('../../models/Vulnerabilities');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('poc')
        .setDescription('Submit a proof-of-concept for a vulnerability')
        .addStringOption(option =>
            option.setName('vulnerability')
                .setDescription('Vulnerability identifier (e.g., CVE-2024-1234)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const user = await User.findOne({discord_id: interaction.user.id});
            if (!user) {
                return interaction.editReply({content: 'User not found.', flags: 64});
            }

            const vulnIdentifier = interaction.options.getString('vulnerability');
            let vulnerabilityId, companyId, platformId;

            if (vulnIdentifier) {
                // Direct submission via identifier
                const vulnerability = await Vulnerability.findOne({
                    vuln_identifier: vulnIdentifier,
                    isResolved: false
                });

                if (!vulnerability) {
                    await interaction.editReply({
                        content: `No unresolved vulnerability found with identifier: **${vulnIdentifier}**`,
                    });
                    return;
                }

                // Check for existing submissions
                const existingReport = await Reports.findOne({
                    user_id: user._id,
                    vulnerability_id: vulnerability._id
                });
                if (existingReport) {
                    return interaction.editReply({
                        content: `You have already submitted a ${existingReport.is_poc_only ? 'POC' : 'report'} for this vulnerability. Only one submission is allowed.`,
                    });
                }

                vulnerabilityId = vulnerability._id;
                companyId = vulnerability.company_id;
                const company = await Company.findById(companyId);
                platformId = company.platform_id;

                const confirmed = await confirmSubmission(interaction, companyId, vulnerabilityId);
                if (!confirmed) return;
            } else {
                // Menu-based submission
                companyId = await selectCompany(interaction);
                if (!companyId) return;

                vulnerabilityId = await selectVulnerability(interaction, companyId);
                if (!vulnerabilityId) return;

                // Check for existing submissions
                const existingReport = await Reports.findOne({
                    user_id: user._id,
                    vulnerability_id: vulnerabilityId
                });
                if (existingReport) {
                    return interaction.editReply({
                        content: `You have already submitted a ${existingReport.is_poc_only ? 'POC' : 'report'} for this vulnerability. Only one submission is allowed.`,
                    });
                }

                const confirmed = await confirmSubmission(interaction, companyId, vulnerabilityId);
                if (!confirmed) return;

                const vulnerability = await Vulnerability.findById(vulnerabilityId);
                platformId = vulnerability.platform_id;
            }

            const report = await saveReport(
                interaction,
                platformId,
                companyId,
                vulnerabilityId,
                user
            );

            await interaction.followUp({
                content: `**POC Submitted Successfully!**\n\n` +
                    `**Report ID:** \`${report._id}\`\n` +
                    `Your proof-of-concept has been submitted to the company.\n\n` +
                    `💰 You might receive a reward for your report within the next 5 minutes.`,
                flags: 64,
            });

        } catch (err) {
            console.error(err);
            await interaction.followUp({
                content: 'An error occurred while submitting your POC.',
                flags: 64,
            });
        }
    },
};

async function waitForSelect(message, userId, allowedCustomIds) {
    try {
        return await message.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
    } catch (err) {
        return null;
    }
}

async function waitForButton(message, userId, allowedCustomIds) {
    if (typeof allowedCustomIds === 'string') {
        allowedCustomIds = [allowedCustomIds];
    }

    try {
        return await message.awaitMessageComponent({
            componentType: ComponentType.Button,
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
    } catch (err) {
        return null;
    }
}

async function selectCompany(interaction) {
    const companies = await Company.find({});
    if (!companies.length) {
        await interaction.followUp({
            content: 'No companies found.',
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
            .setCustomId('close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Company:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_company', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({content: 'POC submission canceled.', components: []});
        return null;
    }

    await response.update({content: 'Company selected.', components: []});
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
                description: `${v.volun_type}`,
                value: v._id.toString(),
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
        content: 'Select a Vulnerability:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_vulnerability', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({content: 'POC submission canceled.', components: []});
        return null;
    }

    await response.update({content: 'Vulnerability selected.', components: []});
    return response.values[0];
}

async function confirmSubmission(interaction, companyId, vulnerabilityId) {
    const company = await Company.findById(companyId);
    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    const summaryContent = `**POC Submission Summary**\n\n` +
        `**Company:** ${company.name}\n` +
        `**Vulnerability:** ${vulnerability.vuln_identifier}\n\n` +
        `Click **Submit POC** to confirm.`;

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('submit')
            .setLabel('Submit POC')
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

    const response = await waitForButton(message, interaction.user.id, ['submit', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({content: 'Submission canceled.', components: []});
        return null;
    }

    await response.update({
        content: 'Submitting POC...',
        components: []
    });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId, user) {
    if (!user) {
        const discordId = interaction.user.id;
        const discordName = interaction.user.username;

        user = await User.findOne({discord_id: discordId});
        if (!user) {
            user = await User.create({
                discord_id: discordId,
                username: discordName,
                reports_made: 0
            });
        }
    }

    await User.updateOne(
        {_id: user._id},
        {$inc: {reports_made: 1}}
    );

    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        is_poc_only: true,
        status: 'poc_submitted',
        volunerablity_sev: vulnerability.severity || 'Medium'
    };

    const report = await Reports.create(reportDoc);

    // Grant visibility to POC submitter
    await Vulnerability.updateOne(
        {_id: vulnerabilityId},
        {$addToSet: {'visibility.allowedUsers': user._id}}
    );

    // Add user to a random subset (80-95%) of field visibility lists
    const fieldNames = [
        'networkAccess',
        'arbitraryCodeExecution',
        'userInteraction',
        'automatable',
        'privilegesRequired',
        'confidentialityImpact',
        'integrityImpact',
        'availabilityImpact',
        'recoveryPotential'
    ];

    // Calculate how many fields to reveal (80-95%)
    const revealPercent = (Math.random() * (95 - 80) + 80) / 100;
    const revealCount = Math.floor(fieldNames.length * revealPercent);

    // Shuffle and pick
    const selectedFields = fieldNames
        .sort(() => 0.5 - Math.random())
        .slice(0, revealCount);

    const addToSetObj = {};
    selectedFields.forEach(field => {
        addToSetObj[`${field}.visibleTo`] = user._id;
    });

    if (Object.keys(addToSetObj).length > 0) {
        await Vulnerability.updateOne(
            {_id: vulnerabilityId},
            {$addToSet: addToSetObj}
        );
    }

    return report;
}
