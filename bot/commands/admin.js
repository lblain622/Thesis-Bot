// bot/commands/admin.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');
const {announceVulnerabilityPatched} = require('../events/announcePatches');
const Vulnerability = require('../../models/Vulnerabilities');
const User = require('../../models/Users');
const Report = require('../../models/Reports');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Exploit = require('../../models/Exploit');
const {clearCollections, loadInitialData} = require('../utils/loadData');
const AnnouncementChannels = require('../../models/AnnouncementChannels');
const {getAnnouncementChannelConfig} = require('../utils/announcementUtils');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands for bot management')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View bot statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setannounce')
                .setDescription('Set announcement channels for different types')
                .addChannelOption(option =>
                    option.setName('vulnerabilities')
                        .setDescription('Channel for vulnerability announcements')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option.setName('trades')
                        .setDescription('Channel for trade notifications')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option.setName('offers')
                        .setDescription('Channel for offer notifications')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option.setName('exploits')
                        .setDescription('Channel for exploit announcements')
                        .setRequired(false)
                )
                .addChannelOption(option =>
                    option.setName('general')
                        .setDescription('Default channel for general announcements')
                        .setRequired(false)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('viewannounce')
                .setDescription('View current announcement channel configuration')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('listusers')
                .setDescription('List all registered users')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('leaderboard')
                .setDescription('Show comprehensive leaderboard')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('addusers')
                .setDescription('Add multiple users to the database')
                .addStringOption(option =>
                    option.setName('user_ids')
                        .setDescription('Comma-separated Discord user IDs')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('resetdata')
                .setDescription('Reset all collections and reload seed data (DANGEROUS)')
        ),


    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();

        // Check if user is admin
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: '  You need Administrator permissions to use this command.',
                ephemeral: true
            });
        }

        switch (subcommand) {
            case 'stats':
                await showStats(interaction);
                break;
            case 'setannounce':
                await setAnnounceChannels(interaction);
                break;
            case 'viewannounce':
                await viewAnnounceChannels(interaction);
                break;
            case 'listusers':
                await listUsers(interaction);
                break;
            case 'leaderboard':
                await showLeaderboard(interaction);
                break;
            case 'addusers':
                await addUsersBulk(interaction);
                break;
            case 'resetdata':
                await resetData(interaction);
                break;
        }
    },
};

async function resetData(interaction) {
    try {
        await interaction.deferReply({ephemeral: true});
        await clearCollections();
        const result = await loadInitialData();

        // Optionally, we could refresh any caches here if needed in the future
        await interaction.editReply({
            content: `✅ Data reset complete. Seeded ${result?.companiesCreated || 0} companies. Loaded ${result?.shopItemsLoaded || 0} shop items.`,
        });
    } catch (err) {
        console.error('resetdata error:', err);
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply({content: '❌ Failed to reset data. Check logs for details.'});
        } else {
            await interaction.reply({content: '❌ Failed to reset data. Check logs for details.', ephemeral: true});
        }
    }
}

async function addUsersBulk(interaction) {
    await interaction.deferReply();

    try {
        const userIdsString = interaction.options.getString('user_ids');
        const userIds = userIdsString.split(',').map(id => id.trim()).filter(id => id.length > 0);

        if (userIds.length === 0) {
            return interaction.editReply('Please provide valid user IDs separated by commas.');
        }

        const results = {
            success: [],
            alreadyExists: [],
            notFound: [],
            errors: []
        };

        for (const userId of userIds) {
            try {
                // Check if user exists in Discord (this will throw if user doesn't exist or bot can't see them)
                const discordUser = await interaction.client.users.fetch(userId).catch(() => null);

                if (!discordUser) {
                    results.notFound.push(userId);
                    continue;
                }

                // Check if user already exists in database
                const existingUser = await User.findOne({discord_id: userId});
                if (existingUser) {
                    results.alreadyExists.push(discordUser.tag);
                    continue;
                }

                // Create new user
                const newUser = await User.create({
                    discord_id: userId,
                    username: discordUser.username,
                    discord_name: discordUser.tag,
                    money_earned: 0,
                    reputation_earned: 0,
                    reports_made: 0,
                    reputation_breakdown: []
                });

                results.success.push(discordUser.tag);

            } catch (error) {
                console.error(`Error processing user ${userId}:`, error);
                results.errors.push(userId);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('Bulk User Addition Results')
            .setColor(results.success.length > 0 ? '#00ff00' : '#ff0000')
            .addFields(
                {
                    name: 'Successfully Added',
                    value: results.success.length > 0 ? results.success.join('\n') : 'None',
                    inline: true
                },
                {
                    name: 'Already Exists',
                    value: results.alreadyExists.length > 0 ? results.alreadyExists.join('\n') : 'None',
                    inline: true
                },
                {
                    name: 'Errors/Not Found',
                    value: results.errors.length > 0 ? results.errors.join(', ') : 'None',
                    inline: true
                }
            )
            .setFooter({text: `Processed ${userIds.length} users`})
            .setTimestamp();

        await interaction.editReply({embeds: [embed]});

    } catch (err) {
        console.error('Error in bulk user addition:', err);
        await interaction.editReply('Error processing bulk user addition.');
    }
}


async function resolveAllVulns(interaction) {
    await interaction.deferReply();

    try {
        const result = await Vulnerability.updateMany(
            {isReported: true, isResolved: false},
            {
                $set: {
                    isResolved: true,
                    is_resolved_date: new Date()
                }
            }
        );

        // Close all active exploits
        await Exploit.updateMany(
            {status: 'Active'},
            {$set: {status: 'Ended'}}
        );

        await interaction.editReply({
            content: `   Resolved **${result.modifiedCount}** vulnerabilities and closed all active exploits.`
        });
    } catch (err) {
        console.error(err);
        await interaction.editReply('  Error resolving vulnerabilities.');
    }
}

async function showStats(interaction) {
    await interaction.deferReply();

    try {
        const totalUsers = await User.countDocuments();
        const totalVulns = await Vulnerability.countDocuments();
        const reportedVulns = await Vulnerability.countDocuments({isReported: true});
        const resolvedVulns = await Vulnerability.countDocuments({isResolved: true});
        const totalReports = await Report.countDocuments();
        const totalExploits = await Exploit.countDocuments();
        const activeExploits = await Exploit.countDocuments({status: 'Active'});
        const totalCompanies = await Company.countDocuments();
        const totalRounds = await Round.countDocuments();

        const totalPayout = await Report.aggregate([
            {$group: {_id: null, total: {$sum: '$offered_amount'}}}
        ]);

        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Statistics')
            .setColor('#0099ff')
            .addFields(
                {name: '👥 Users', value: `${totalUsers}`, inline: true},
                {name: ' Companies', value: `${totalCompanies}`, inline: true},
                {name: 'Rounds', value: `${totalRounds}`, inline: true},
                {name: 'Total Vulnerabilities', value: `${totalVulns}`, inline: true},
                {name: 'Reported', value: `${reportedVulns}`, inline: true},
                {name: 'Resolved', value: `${resolvedVulns}`, inline: true},
                {name: 'Total Reports', value: `${totalReports}`, inline: true},
                {name: ' Total Exploits', value: `${totalExploits}`, inline: true},
                {name: ' Active Exploits', value: `${activeExploits}`, inline: true},
                {name: 'Total Payouts', value: `$${totalPayout[0]?.total || 0}`, inline: false}
            )
            .setTimestamp();

        await interaction.editReply({embeds: [embed]});
    } catch (err) {
        console.error(err);
        await interaction.editReply(' Error fetching statistics.');
    }
}

async function setAnnounceChannels(interaction) {
    await interaction.deferReply();

    try {
        const guildId = interaction.guildId;
        const channelsConfig = {
            vulnerabilities: interaction.options.getChannel('vulnerabilities')?.id || null,
            trades: interaction.options.getChannel('trades')?.id || null,
            offers: interaction.options.getChannel('offers')?.id || null,
            exploits: interaction.options.getChannel('exploits')?.id || null,
            general: interaction.options.getChannel('general')?.id || null
        };

        // Remove null values to keep config clean
        Object.keys(channelsConfig).forEach(key => {
            if (channelsConfig[key] === null) {
                delete channelsConfig[key];
            }
        });

        if (Object.keys(channelsConfig).length === 0) {
            return await interaction.editReply({
                content: '❌ Please specify at least one channel to configure.'
            });
        }

        // Update database
        const config = await AnnouncementChannels.findOneAndUpdate(
            { guild_id: guildId },
            {
                guild_id: guildId,
                $set: { channels: channelsConfig, updated_at: new Date() }
            },
            { upsert: true, new: true }
        );

        // Build response
        const configuredChannels = Object.entries(config.channels)
            .filter(([_, channelId]) => channelId)
            .map(([type, channelId]) => `• **${type}**: <#${channelId}>`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle('✅ Announcement Channels Configured')
            .setColor('#00ff00')
            .setDescription('The following channels have been set for announcements:\n\n' + configuredChannels)
            .setFooter({text: 'Users will now receive notifications in these server channels instead of DMs.'})
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error('Error setting announcement channels:', err);
        await interaction.editReply({
            content: '❌ Error configuring announcement channels. Check logs for details.'
        });
    }
}

async function viewAnnounceChannels(interaction) {
    await interaction.deferReply();

    try {
        const guildId = interaction.guildId;
        const config = await AnnouncementChannels.findOne({ guild_id: guildId });

        if (!config || Object.keys(config.channels || {}).length === 0) {
            return await interaction.editReply({
                content: '❌ No announcement channels configured. Use `/admin setannounce` to configure them.'
            });
        }

        const configuredChannels = Object.entries(config.channels)
            .filter(([_, channelId]) => channelId)
            .map(([type, channelId]) => `• **${type}**: <#${channelId}>`)
            .join('\n');

        const unconfiguredTypes = [
            'vulnerabilities', 'trades', 'offers', 'exploits', 'general'
        ].filter(type => !config.channels[type])
            .join(', ');

        const embed = new EmbedBuilder()
            .setTitle('📋 Current Announcement Channel Configuration')
            .setColor('#0099ff')
            .addFields(
                {
                    name: 'Configured Channels',
                    value: configuredChannels || 'None',
                    inline: false
                },
                {
                    name: 'Not Configured',
                    value: unconfiguredTypes || 'All types configured!',
                    inline: false
                }
            )
            .setFooter({text: 'Use `/admin setannounce` to change these settings.'})
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error('Error viewing announcement channels:', err);
        await interaction.editReply({
            content: '❌ Error retrieving announcement channel configuration.'
        });
    }
}


async function listUsers(interaction) {
    await interaction.deferReply();

    try {
        const users = await User.find({}).sort({money_earned: -1}).limit(25);

        const embed = new EmbedBuilder()
            .setTitle('👥 Registered Users')
            .setColor('#00ff00')
            .setDescription(
                users.map((u, idx) =>
                    `${idx + 1}. **${u.discord_name}** - $${u.money_earned} - ${u.reports_made} reports`
                ).join('\n')
            )
            .setFooter({text: `Total: ${await User.countDocuments()} users`});

        await interaction.editReply({embeds: [embed]});
    } catch (err) {
        console.error(err);
        await interaction.editReply('Error listing users.');
    }
}

async function showLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const topEarners = await User.find({}).sort({money_earned: -1}).limit(10);
        const topReporters = await User.find({}).sort({reports_made: -1}).limit(10);
        const topReputation = await User.find({}).sort({reputation_earned: -1}).limit(10);

        const embed = new EmbedBuilder()
            .setTitle('Leaderboard')
            .setColor('#FFD700')
            .addFields(
                {
                    name: '💰 Top Earners',
                    value: topEarners.map((u, idx) =>
                        `${['🥇', '🥈', '🥉'][idx] || `${idx + 1}.`} ${u.discord_name} - $${u.money_earned}`
                    ).join('\n'),
                    inline: true
                },
                {
                    name: '📊 Top Reporters',
                    value: topReporters.map((u, idx) =>
                        `${['🥇', '🥈', '🥉'][idx] || `${idx + 1}.`} ${u.discord_name} - ${u.reports_made} reports`
                    ).join('\n'),
                    inline: true
                },
                {
                    name: '⭐ Top Reputation',
                    value: topReputation.map((u, idx) =>
                        `${['🥇', '🥈', '🥉'][idx] || `${idx + 1}.`} ${u.discord_name} - ${u.repuation_earned} pts`
                    ).join('\n'),
                    inline: true
                }
            )
            .setTimestamp();

        await interaction.editReply({embeds: [embed]});
    } catch (err) {
        console.error(err);
        await interaction.editReply('  Error generating leaderboard.');
    }
}
