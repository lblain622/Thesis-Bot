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
        .addStringOption(option =>
            option.setName('company')
                .setDescription('Company name to report to directly')
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
            const companyName = interaction.options.getString('company');
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

                const canReportVulnerability = vulnerability.visibility?.isGlobal ||
                    (vulnerability.visibility?.allowedUsers || []).some(id => id.toString() === user._id.toString()) ||
                    (vulnerability.discovered_by || []).some(d => d.user_id?.toString() === user._id.toString());
                if (!canReportVulnerability) {
                    return interaction.editReply({
                        content: `You have not discovered **${vulnIdentifier}** yet. Use \`/search\` to find vulnerabilities first.`,
                        flags: 64
                    });
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
                companyId = companyName
                    ? await findCompanyIdByName(interaction, companyName)
                    : await selectCompanyAdvanced(interaction);
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
                    const userMeets = userDoc && (userDoc.reputation_earned || 0) >= repThresh;
                    const voucherMeets = voucherDoc && (voucherDoc.reputation_earned || 0) >= repThresh;
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
                vulnerabilityId = await selectVulnerability(interaction);
                if (!vulnerabilityId) return;

                companyId = companyName
                    ? await findCompanyIdByName(interaction, companyName)
                    : await selectCompanyAdvanced(interaction);
                if (!companyId) return;

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
                    const userMeets = userDoc && (userDoc.reputation_earned || 0) >= repThresh;
                    const voucherMeets = voucherDoc && (voucherDoc.reputation_earned || 0) >= repThresh;
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
                    `💰 You might receive a reward for your report within the next minute.`;
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
            const offerDelayMs = 15 * 1000; // 15 seconds

            setTimeout(async () => {
                try {
                    // Check cache first for platform
                    let platform = cache.getPlatform(platformId);
                    if (!platform) {
                        platform = await Platform.findById(platformId).lean();
                        if (platform) cache.setPlatform(platformId, platform);
                    }

                    if (!platform) {
                        console.warn(`No platform found for report ${report._id}; defaulting to standard offer.`);
                        await generateOffer(interaction.client, report, interaction.user);
                    } else if (platform.name.includes('Dictator')) {
                        await generateDictatorOffer(interaction.client, report, interaction.user);
                    } else {
                        await generateOffer(interaction.client, report, interaction.user);
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

async function waitForAnyComponent(message, userId, allowedCustomIds) {
    // Wait for either StringSelect or Button components
    try {
        return await message.awaitMessageComponent({
            filter: i => i.user.id === userId && allowedCustomIds.includes(i.customId),
            time: 300_000
        });
    } catch (err) {
        return null;
    }
}


async function selectCompanyAdvanced(interaction) {
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
                const desc = formatCompanySelectDescription(c);
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
            .setCustomId('report_type_dropdown')
            .setLabel('📋 Use Dropdown')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('report_type_search')
            .setLabel('🔍 Search by Name')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId('report_close')
            .setLabel('❌ Close')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: 'Select a Company (Use dropdown above or search by name):',
        components: [row, buttons],
        fetchReply: true
    });

    // Wait for either a menu selection or button click
    const response = await waitForAnyComponent(message, interaction.user.id, ['select_company', 'report_type_dropdown', 'report_type_search', 'report_close']);
    if (!response) return null;

    if (response.customId === 'report_close') {
        await response.update({content: 'Report canceled.', components: []});
        return null;
    }

    if (response.customId === 'select_company') {
        await response.update({content: 'Company selected.', components: []});
        return response.values[0];
    }

    if (response.customId === 'report_type_dropdown') {
        await response.deferUpdate();
        // Show dropdown menu again
        const dropdownMessage = await interaction.followUp({
            content: 'Select a Company from the list:',
            components: [row],
            fetchReply: true
        });
        const dropdownResponse = await waitForSelect(dropdownMessage, interaction.user.id, ['select_company']);
        if (!dropdownResponse) return null;
        await dropdownResponse.deferUpdate();
        return dropdownResponse.values[0];
    }

    if (response.customId === 'report_type_search') {
        await response.deferUpdate();
        return await searchCompanyByName(interaction, companies);
    }

    return null;
}

async function searchCompanyByName(interaction, companies) {
    const userId = interaction.user.id;
    
    // Prompt for company name
    const prompt = await interaction.followUp({
        content: `\n📝 **Type the name of the company you want to report to:**\n\nAvailable companies:\n${companies.map(formatCompanySearchLine).join('\n')}`,
        flags: 64,
        fetchReply: true
    });

    try {
        // Wait for a message from the user
        const collected = await interaction.channel.awaitMessages({
            filter: m => m.author.id === userId,
            max: 1,
            time: 300_000
        });

        if (collected.size === 0) {
            return null;
        }

        const userInput = collected.first().content.trim().toLowerCase();
        
        // Find matching company (case-insensitive exact, or a unique partial match)
        const exactMatch = companies.find(c => c.name.toLowerCase() === userInput);
        const partialMatches = companies.filter(c => c.name.toLowerCase().includes(userInput));
        const matchedCompany = exactMatch || (partialMatches.length === 1 ? partialMatches[0] : null);
        
        if (!matchedCompany) {
            await interaction.followUp({
                content: `❌ No company found with the name "${userInput}". Please try again.`,
                flags: 64
            });
            return null;
        }

        await interaction.followUp({
            content: `✅ Company "${matchedCompany.name}" selected.`,
            flags: 64
        });

        return matchedCompany._id.toString();
    } catch (err) {
        console.error('Error in searchCompanyByName:', err);
        return null;
    }
}

async function findCompanyIdByName(interaction, companyName) {
    const companies = await Company.find({}).lean();
    const normalized = companyName.trim().toLowerCase();
    const exactMatch = companies.find(c => c.name.toLowerCase() === normalized);
    const partialMatches = companies.filter(c => c.name.toLowerCase().includes(normalized));
    const matchedCompany = exactMatch || (partialMatches.length === 1 ? partialMatches[0] : null);

    if (!matchedCompany) {
        const available = companies.map(c => `â€¢ **${c.name}**`).join('\n');
        await interaction.editReply({
            content: `No single company matched **${companyName}**.\n\nAvailable companies:\n${available}`,
            flags: 64
        });
        return null;
    }

    return matchedCompany._id.toString();
}

function formatVulnType(type) {
    return String(type || 'Any').replace(/_/g, ' ');
}

function formatReputationHint(company) {
    const threshold = Number(company?.reputation_threshold || 0);
    if (threshold > 0) return `rep ${threshold}+`;

    const tierStarts = (company?.reputation_tiers || [])
        .map(t => Number(t.min_reputation || 0))
        .filter(n => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);

    return tierStarts.length ? `better offers near rep ${tierStarts[0]}+` : 'no rep minimum';
}

function formatCompanySelectDescription(company) {
    const prefs = (company?.preferred_vulns || [])
        .slice(0, 2)
        .map(formatVulnType)
        .join(', ');
    const prefHint = prefs ? `Likes: ${prefs}` : 'Likes: any vuln';
    return `${prefHint} | ${formatReputationHint(company)}`.slice(0, 100);
}

function formatCompanySearchLine(company) {
    const prefs = (company?.preferred_vulns || [])
        .slice(0, 3)
        .map(formatVulnType)
        .join(', ') || 'any vulnerability type';
    return `• **${company.name}** — prefers ${prefs}; ${formatReputationHint(company)}`;
}

async function selectVulnerability(interaction) {
    // also check which ones user is currently exploiting so we can warn in the menu
    const user = await User.findOne({discord_id: interaction.user.id});
    let exploitedIds = new Set();
    if (user) {
        const activeExploits = await Exploit.find({user_id: user._id, status: 'Active'}).lean();
        exploitedIds = new Set(activeExploits.map(e => e.volunerability_id.toString()));
    }

    const vulnerabilities = await Vulnerability.find({
        isResolved: false,
        $or: [
            {'visibility.isGlobal': true},
            {'visibility.allowedUsers': user._id},
            {'discovered_by.user_id': user._id}
        ]
    }).lean();

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
                const status = v.isReported ? 'Reported' : 'Unreported';
                const desc = `${status} • ${v.volun_type}`;
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

    const response = await waitForAnyComponent(message, interaction.user.id, ['select_vulnerability', 'report_close']);
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
    const company = await Company.findById(companyId).lean();
    const reputation = user.reputation_earned || 0;
    const matchingTier = (company?.reputation_tiers || []).find(t =>
        reputation >= (t.min_reputation || 0) && reputation <= (t.max_reputation || Number.MAX_SAFE_INTEGER)
    );
    const reputationBonus = matchingTier
        ? Math.max(0, Math.round(((matchingTier.bonus_multiplier || 1) - 1) * 100))
        : 0;
    const preferredVulnBonus = company?.preferred_vulns?.includes(vulnerability.volun_type) ? 20 : 0;

    // handle voucher user lookup and notification
    let voucherId = null;
    if (targetUser) {
        let voucherDoc = await User.findOne({discord_id: targetUser.id});
        if (!voucherDoc) {
            voucherDoc = await User.create({
                discord_id: targetUser.id,
                discord_name: targetUser.username,
                reports_made: 0
            });
        }
        voucherId = voucherDoc._id;

        // send confirmation to the voucher's dashboard channel only
        try {
            const { notifyUser } = require('../utils/logUtils');
            await notifyUser(interaction.client, voucherDoc._id,
                `You have vouched for ${interaction.user.username} on a report to a company. ` +
                `If either of you meets the company's reputation threshold and an offer is generated, you will receive a share of the reward.`
            );
        } catch (e) {
            console.error('Failed to send voucher dashboard notification', e);
        }
    }

    const reportDoc = {
        user_id: user._id,
        platform_id: platformId,
        company_id: companyId,
        vulnerability_id: vulnerabilityId,
        status: 'open',
        volunerablity_sev: vulnerability.severity || 'MEDIUM',
        reputation_bonus: reputationBonus,
        preferred_vuln_bonus: preferredVulnBonus,
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

