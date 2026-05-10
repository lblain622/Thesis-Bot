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
const Exploit = require('../../models/Exploit');
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
        )
        .addUserOption(option =>
                            option.setName('voucher')
                                .setDescription('User who is vouching for your report')
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
            const targetUser = interaction.options.getUser('voucher');
            let vulnerabilityId, companyId, platformId;

            
            if (targetUser) {
                if (targetUser.bot) {
                    return interaction.editReply({content: 'You cannot have the bot vouch for you', flags: 64});
                }
                if (targetUser.id === interaction.user.id) {
                    return interaction.editReply({content: 'You cannot vouch for yourself', flags: 64});
                }
            }
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
                        content: `You have already submitted a Report for this vulnerability. Only one submission is allowed.`,
                    });
                }

                vulnerabilityId = vulnerability._id;
                companyId = await selectCompany(interaction);
                if (!companyId) return;

                const company = await Company.findById(companyId);
                platformId = company.platform_id;

                // reputation threshold check after company load
                const repThresh = company.reputation_threshold || 0;
                if (repThresh > 0) {
                    const userDoc = await User.findOne({discord_id: interaction.user.id});
                    let voucherDoc = null;
                    if (targetUser) {
                        voucherDoc = await User.findOne({discord_id: targetUser.id});
                    }
                    const userMeets = userDoc && userDoc.reputation >= repThresh;
                    const voucherMeets = voucherDoc && voucherDoc.reputation >= repThresh;
                    if (!userMeets && !voucherMeets) {
                        return interaction.editReply({
                            content: `Neither you nor your voucher meet the reputation threshold (${repThresh}) required to submit reports to **${company.name}**.`,
                            flags: 64
                        });
                    }
                }

                // warn if user is currently exploiting this vuln
                const isExploiting = await Exploit.exists({
                    user_id: user._id,
                    volunerability_id: vulnerabilityId,
                    status: 'Active'
                });

                const confirmed = await confirmSubmission(interaction, companyId, vulnerabilityId, isExploiting);
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

                // warn if user is currently exploiting this vuln
                const isExploiting = await Exploit.exists({
                    user_id: user._id,
                    volunerability_id: vulnerabilityId,
                    status: 'Active'
                });

                const confirmed = await confirmSubmission(interaction, companyId, vulnerabilityId, isExploiting);
                if (!confirmed) return;

                const company = await Company.findById(companyId);
                platformId = company.platform_id;

                // reputation threshold check for menu path
                const repThresh = company.reputation_threshold || 0;
                if (repThresh > 0) {
                    const userDoc = await User.findOne({discord_id: interaction.user.id});
                    let voucherDoc = null;
                    if (targetUser) {
                        voucherDoc = await User.findOne({discord_id: targetUser.id});
                    }
                    const userMeets = userDoc && userDoc.reputation >= repThresh;
                    const voucherMeets = voucherDoc && voucherDoc.reputation >= repThresh;
                    if (!userMeets && !voucherMeets) {
                        return interaction.editReply({
                            content: `Neither you nor your voucher meet the reputation threshold (${repThresh}) required to submit reports to **${company.name}**.`,
                            flags: 64
                        });
                    }
                }
            }

            const report = await saveReport(
                interaction,
                platformId,
                companyId,
                vulnerabilityId,
                user,
                targetUser // this is a Discord.User object
            );

            // pull vuln/company data to give user more context
            const vulnDoc = await Vulnerability.findById(vulnerabilityId).lean();
            const companyDoc = await Company.findById(companyId).lean();

            let followMsg = `**Report Submitted Successfully!**\n\n` +
                    `You submitted **${vulnDoc?.vuln_identifier || 'a vulnerability'}** to **${companyDoc?.name || 'the company'}**.\n\n` +
                    `💰 You might receive a reward for your report within the next 5 minutes.`;
            if (targetUser) {
                followMsg += `\n
Your voucher ${targetUser.username} has been notified.`;
            }

            await interaction.followUp({
                content: followMsg,
                flags: 64,
            });

            // notify user in dashboard channel
            try {
                const { notifyUser } = require('../utils/logUtils');
                const vulnDoc2 = await Vulnerability.findById(vulnerabilityId).lean();
                await notifyUser(interaction.client, user._id,
                    `✅ You submitted a vulnerability report (${vulnDoc2?.vuln_identifier || vulnerabilityId}).`);
            } catch (e) {
                console.error('Report dashboard notification error:', e);
            }

            // Generate offer after delay
            const offerDelayMs = 30 * 1000; // 30 seconds

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
            companies.map(c => {
                let desc = c.description?.slice(0, 80) || 'No description';
                if (c.reputation_threshold && c.reputation_threshold > 0) {
                    desc += ` · rep≥${c.reputation_threshold}`;
                }
                return {
                    label: c.name,
                    description: desc,
                    value: c._id.toString(),
                };
            })
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('report_close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Company:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_company', 'report_close']);
    if (!response) return null;

    if (response.customId === 'report_close') {
        await response.update({content: 'Report canceled.', components: []});
        return null;
    }

    await response.update({content: 'Company selected.', components: []});
    return response.values[0];
}

async function selectVulnerability(interaction, companyId) {
    // also check which ones user is currently exploiting so we can warn in the menu
    const user = await User.findOne({discord_id: interaction.user.id});
    let exploitedIds = new Set();
    if (user) {
        const activeExploits = await Exploit.find({user_id: user._id, status: 'Active'}).lean();
        exploitedIds = new Set(activeExploits.map(e => e.volunerability_id.toString()));
    }

    const vulnerabilities = await Vulnerability.find({
        isResolved: false
    }).populate('company_id', 'name').lean();

    if (!vulnerabilities.length) {
        await interaction.followUp({
            content: 'No unresolved vulnerabilities are currently available.',
            flags: 64,
        });
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_vulnerability')
        .setPlaceholder('Select a vulnerability')
        .addOptions(
            vulnerabilities.slice(0, 25).map(v => {
                const companyName = v.company_id?.name || 'Unknown';
                const status = v.isReported ? 'Reported' : 'Unreported';
                const desc = `${companyName} • ${status} • ${v.volun_type}`;
                return {
                    label: v.vuln_identifier,
                    description: desc.slice(0, 100), // Discord limit
                    value: v._id.toString(),
                };
            })
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('report_close')
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Vulnerability:',
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForSelect(message, interaction.user.id, ['select_vulnerability', 'report_close']);
    if (!response) return null;

    if (response.customId === 'report_close') {
        await response.update({content: 'Report canceled.', components: []});
        return null;
    }

    await response.update({content: 'Vulnerability selected.', components: []});
    return response.values[0];
}

async function confirmSubmission(interaction, companyId, vulnerabilityId, isExploiting = false) {
    // Parallel fetch for better performance
    const [company, vulnerability] = await Promise.all([
        Company.findById(companyId).lean(),
        Vulnerability.findById(vulnerabilityId).lean()
    ]);

    let summaryContent = `**Full Report Summary**\n\n` +
        `**Company:** ${company.name}\n` +
        `**Vulnerability:** ${vulnerability.vuln_identifier}\n` +
        `**Type:** ${vulnerability.volun_type}\n\n` +
        `Click **Submit Report** to confirm.`;

    if (isExploiting) {
        summaryContent += `\n\n⚠️ **Warning:** You are currently exploiting this vulnerability. Reporting it may expose you and increase the risk of being caught.`;
    }

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('report_submit')
            .setLabel('Submit Report')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('report_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: summaryContent,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForButton(message, interaction.user.id, ['report_submit', 'report_cancel']);
    if (!response) return null;

    if (response.customId === 'report_cancel') {
        await response.update({content: 'Submission canceled.', components: []});
        return null;
    }

    await response.update({
        content: 'Submitting report...',
        components: []
    });
    return true;
}

async function saveReport(interaction, platformId, companyId, vulnerabilityId, user, targetUser) {
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

    // handle voucher user lookup and notification
    let voucherId = null;
    if (targetUser) {
        let voucherDoc = await User.findOne({discord_id: targetUser.id});
        if (!voucherDoc) {
            voucherDoc = await User.create({
                discord_id: targetUser.id,
                username: targetUser.username,
                reports_made: 0
            });
        }
        voucherId = voucherDoc._id;

        // send confirmation DM to voucher
        try {
            const discordVoucher = await interaction.client.users.fetch(targetUser.id);
            await discordVoucher.send(
                `You have vouched for ${interaction.user.username} on a report to a company. ` +
                `If either of you meets the company's reputation threshold and an offer is generated, you will receive a share of the reward.`
            );
        } catch (e) {
            console.error('Failed to send DM to voucher user', e);
        }
    }

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        status: 'open',
        volunerablity_sev: vulnerability.severity || 'Medium',
        VouchingUser: voucherId
    };

    const report = await Reports.create(reportDoc);

    // Update vulnerability - mark as reported and add to reported_by
    await Vulnerability.updateOne(
        {_id: vulnerabilityId},
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
        {upsert: false}
    );

    return report;
}