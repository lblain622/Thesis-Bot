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
const generateOffer = require('../utils/generateOffer');
const generateDictatorOffer = require('../utils/generateDicOffer');

//TODO: add limit to reporting,so users dont spam command
// maybe limit of 3 reports max (could get more info and report again)
// only 1 poc can be submitted per voluneribiltiy

module.exports = {
    data: new SlashCommandBuilder()
        .setName('report')
        .setDescription('Submit a vulnerability report or POC'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {

            const reportType = await selectReportType(interaction);
            if (!reportType) return;

            const platformId = await selectPlatform(interaction);
            if (!platformId) return;

            const companyId = await selectCompany(interaction, platformId);
            if (!companyId) return;

            const vulnerabilityId = await selectVulnerability(interaction, companyId);
            if (!vulnerabilityId) return;

            const confirmed = await confirmSubmission(
                interaction,
                platformId,
                companyId,
                vulnerabilityId,
                reportType
            );
            if (!confirmed) return;


            const report = await saveReport(
                interaction,
                platformId,
                companyId,
                vulnerabilityId,
                reportType === 'poc'
            );

            const typeLabel = reportType === 'poc' ? 'POC' : 'Report';
            await interaction.followUp({
                content: `**${typeLabel} Submitted Successfully!**\n\n` +
                    `**Report ID:** \`${report._id}\`\n` +
                    `Your ${typeLabel.toLowerCase()} has been submitted to the company.`,
                flags: 64,
            });

            // Generate offer after delay
//            const offerDelayMs = process.env.OFFER_DELAY_MINUTES
//                ? parseInt(process.env.OFFER_DELAY_MINUTES) * 60 * 1000
//                : 5 * 60 * 1000;
const offerDelayMs = 30*1000; // 30 seconds

            setTimeout(async () => {
                try {
                    const platform = await Platform.findById(platformId);
                    await Company.findById(companyId);
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

async function selectReportType(interaction) {
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('full_report')
            .setLabel('Full Report')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('poc_only')
            .setLabel('POC Only')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('close')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
    );

    const message = await interaction.editReply({
        content: '**Select Report Type:**\n\n' +
            '📋 **Full Report** - Complete vulnerability report\n' +
            '🔬 **POC Only** - Just proof-of-concept for a vulnerability',
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['full_report', 'poc_only', 'close']);
    if (!response) return null;

    if (response.customId === 'close') {
        await response.update({ content: 'Report canceled.', components: [] });
        return null;
    }

    await response.update({
        content: `Selected: **${response.customId === 'full_report' ? 'Full Report' : 'POC Only'}**`,
        components: []
    });

    return response.customId === 'full_report' ? 'full' : 'poc';
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
                description: `${v.volun_type}`,
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

async function confirmSubmission(interaction, platformId, companyId, vulnerabilityId, reportType) {
    const platform = await Platform.findById(platformId);
    const company = await Company.findById(companyId);
    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    let summaryContent;
    if (reportType === 'full') {
        summaryContent = `**Full Report Summary**\n\n` +
            `**Platform:** ${platform.name}\n` +
            `**Company:** ${company.name}\n` +
            `**Vulnerability:** ${vulnerability.vuln_identifier}\n` +
            `**Type:** ${vulnerability.volun_type}\n\n` +
            `Click **Submit Report** to confirm.`;
    } else {
        summaryContent = `**POC Submission Summary**\n\n` +
            `**Platform:** ${platform.name}\n` +
            `**Company:** ${company.name}\n` +
            `**Vulnerability:** ${vulnerability.vuln_identifier}\n\n` +
            `Click **Submit POC** to confirm and earn a company offer.`;
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('submit')
            .setLabel(reportType === 'full' ? 'Submit Report' : 'Submit POC')
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
        content: `Submitting ${reportType === 'full' ? 'report' : 'POC'}...`,
        components: []
    });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId, isPOCOnly) {
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

    const vulnerability = await Vulnerability.findById(vulnerabilityId);

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        is_poc_only: isPOCOnly,
        status: isPOCOnly ? 'poc_submitted' : 'open',
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

    //TODO: modify this so that we give access to volun after offer is made as wel
    //since offer and amount is based upon how much info is given, and there is a delay in submission now,
    //we need to make sure that we can check before giving a the info
    //maybe range all users access to voln. once resovled
    // Grant user access to vulnerability fields after report/POC submission
    if(isPOCOnly){
        await Vulnerability.updateOne(
            { _id: vulnerabilityId },
            { $addToSet: { 'visibility.allowedUsers': user._id } }
        );

        // Add user to all field visibility lists
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

        const updateObj = {};
        fieldNames.forEach(field => {
            updateObj[`${field}.visibleTo`] = user._id;
        });

        await Vulnerability.updateOne(
            { _id: vulnerabilityId },
            { $addToSet: updateObj }
        );
    }
    await checkExploitsAfterReport(vulnerabilityId);
        return report;

}

//TODO: lets now check explosits after the voln is resolved instead!
async function checkExploitsAfterReport(vulnerabilityId) {
    try {
        const Exploit = require('../../models/Expoits');
        const affectedExploits = await Exploit.find({
            volunerability_id: vulnerabilityId,
            is_caught: false
        });

        if (affectedExploits.length > 0) {
            const caughtExploits = [];
            const safeExploits = [];

            for (const exploit of affectedExploits) {
                const randomChance = Math.random();

                if (randomChance <= exploit.exposure_chance) {
                    exploit.is_caught = true;
                    await exploit.save();

                    caughtExploits.push({
                        exploit_id: exploit._id,
                        user_id: exploit.user_id,
                        exposure_chance: exploit.exposure_chance,
                        cycles_completed: exploit.cycles_completed,
                        caught_at: new Date()
                    });
                } else {
                    safeExploits.push({
                        exploit_id: exploit._id,
                        user_id: exploit.user_id
                    });
                }
            }

            console.log(`Vulnerability reported: ${caughtExploits.length}/${affectedExploits.length} exploits caught.`);

            return {
                caughtExploits,
                safeExploits,
                totalAffected: affectedExploits.length,
                caughtCount: caughtExploits.length
            };
        }

        return null;
    } catch (err) {
        console.error('Error checking exploits after report:', err);
        throw err;
    }
}