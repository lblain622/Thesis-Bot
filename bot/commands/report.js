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
const generateOffer = require('../utils/generateOffer');
const generateDictatorOffer = require('../utils/generateDicOffer');
const cache = require('../utils/cache');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a full vulnerability report')
        .addStringOption(option =>
            option.setName('vulnerability')
                .setDescription('Vulnerability identifier (e.g., CVE-2024-1234)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const user = await User.findOne({ discord_id: interaction.user.id });
            if (!user) {
                return interaction.editReply({ content: 'User not found.', flags: 64 });
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
                const company = await Company.findById(companyId);
                platformId = company.platform_id;
            }

            const report = await saveReport(
                interaction,
                platformId,
                companyId,
                vulnerabilityId,
                user
            );

            await interaction.followUp({
                content: `**Report Submitted Successfully!**\n\n` +
                    `**Report ID:** \`${report._id}\`\n` +
                    `Your report has been submitted to the company.\n\n` +
                    `💰 You might receive a reward for your report within the next 5 minutes.`,
                flags: 64,
            });

            // Generate offer after delay
const offerDelayMs = 30*1000; // 30 seconds

            setTimeout(async () => {
                try {
                    // Check cache first for platform
                    let platform = cache.getPlatform(platformId);
                    if (!platform) {
                        platform = await Platform.findById(platformId).lean();
                        if (platform) cache.setPlatform(platformId, platform);
                    }

                    if (platform.name.includes('Ultimatum')) {
                        await generateOffer(interaction.client, report, interaction.user);
                    } else if (platform.name.includes('Dictator')) {
                        await generateDictatorOffer(interaction.client, report, interaction.user);
                    }
                } catch (err) {
                    console.error('Error generating delayed offer:', err);
                }
            }, offerDelayMs);

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
    // Try to get companies from cache first
    const companies = await Company.find({}).lean();

    // Cache all companies for future use
    companies.forEach(c => cache.setCompany(c._id, c));

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
    }).lean();

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
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({ content: 'Vulnerability selected.', components: [] });
    return response.values[0];
}

async function confirmSubmission(interaction, companyId, vulnerabilityId) {
    // Parallel fetch for better performance
    const [company, vulnerability] = await Promise.all([
        Company.findById(companyId).lean(),
        Vulnerability.findById(vulnerabilityId).lean()
    ]);

    const summaryContent = `**Full Report Summary**\n\n` +
        `**Company:** ${company.name}\n` +
        `**Vulnerability:** ${vulnerability.vuln_identifier}\n` +
        `**Type:** ${vulnerability.volun_type}\n\n` +
        `Click **Submit Report** to confirm.`;

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
        content: summaryContent,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['submit', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Submission canceled.', components: [] });
        return null;
    }

    await response.update({
        content: 'Submitting report...',
        components: []
    });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId, user) {
    if (!user) {
        const discordId = interaction.user.id;
        const discordName = interaction.user.username;

        user = await User.findOne({ discord_id: discordId });
        if (!user) {
            user = await User.create({
                discord_id: discordId,
                username: discordName,
                reports_made: 0
            });
        }
    }

    await User.updateOne(
        { _id: user._id },
        { $inc: { reports_made: 1 } }
    );

    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        is_poc_only: false,
        status: 'open',
        volunerablity_sev: vulnerability.severity || 'Medium'
    };

    const report = await Reports.create(reportDoc);

    // Update vulnerability - mark as reported and add to reported_by
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
            },
            $setOnInsert: {
                first_reporter: user._id,
                first_reported_at: new Date()
            }
        },
        { upsert: false }
    );

    return report;
}
//
////TODO: lets now check explosits after the voln is resolved instead!
//async function checkExploitsAfterReport(vulnerabilityId) {
//    try {
//        const Exploit = require('../../models/Expoits');
//        const affectedExploits = await Exploit.find({
//            volunerability_id: vulnerabilityId,
//            is_caught: false
//        });
//
//        if (affectedExploits.length > 0) {
//            const caughtExploits = [];
//            const safeExploits = [];
//
//            for (const exploit of affectedExploits) {
//                const randomChance = Math.random();
//
//                if (randomChance <= exploit.exposure_chance) {
//                    exploit.is_caught = true;
//                    await exploit.save();
//
//                    caughtExploits.push({
//                        exploit_id: exploit._id,
//                        user_id: exploit.user_id,
//                        exposure_chance: exploit.exposure_chance,
//                        cycles_completed: exploit.cycles_completed,
//                        caught_at: new Date()
//                    });
//                } else {
//                    safeExploits.push({
//                        exploit_id: exploit._id,
//                        user_id: exploit.user_id
//                    });
//                }
//            }
//
//            console.log(`Vulnerability reported: ${caughtExploits.length}/${affectedExploits.length} exploits caught.`);
//
//            return {
//                caughtExploits,
//                safeExploits,
//                totalAffected: affectedExploits.length,
//                caughtCount: caughtExploits.length
//            };
//        }
//
//        return null;
//    } catch (err) {
//        console.error('Error checking exploits after report:', err);
//        throw err;
//    }
//}