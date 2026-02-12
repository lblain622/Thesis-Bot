// bot/commands/admin.js
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder
} = require('discord.js');
const { generateDailyVulnerabilities, endRound, announceNewRound, startRound: startRoundScheduler } = require('../utils/roundSystem');
const { announceVulnerabilityPatched } = require('../events/announcePatches');
const Vulnerability = require('../../models/Vulnerabilities');
const User = require('../../models/Users');
const Report = require('../../models/Reports');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Exploit = require('../../models/Exploit');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Admin commands for bot management')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName('startround')
                .setDescription('Start a new round and generate vulnerabilities')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to announce in')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('endround')
                .setDescription('End current round and show summary')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to announce in')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View bot statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('setannounce')
                .setDescription('Set announcement channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for announcements')
                        .setRequired(true)
                )
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
            case 'startround':
                await startRoundCmd(interaction);
                break;
            case 'endround':
                await endRoundCommand(interaction);
                break;
            case 'stats':
                await showStats(interaction);
                break;
            case 'setannounce':
                await setAnnounceChannel(interaction);
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
        }
    },
};
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
                const existingUser = await User.findOne({ discord_id: userId });
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
            .setFooter({ text: `Processed ${userIds.length} users` })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

    } catch (err) {
        console.error('Error in bulk user addition:', err);
        await interaction.editReply('Error processing bulk user addition.');
    }
}
async function startRoundCmd(interaction) {
    await interaction.deferReply();

    try {
        const channel = interaction.options.getChannel('channel');

        // Start the scheduled round system (enables auto-run after first admin start)
        await startRoundScheduler(interaction.client, channel.id);

        await interaction.editReply({
            content: `New round started and scheduler enabled. Announcements in ${channel}.`
        });
    } catch (err) {
        console.error(err);
        await interaction.editReply('Error starting round.');
    }
}

async function endRoundCommand(interaction) {
    await interaction.deferReply();

    try {
        const channel = interaction.options.getChannel('channel');

        // End round and show summary
        await endRound(interaction.client, channel.id);

        await interaction.editReply({
            content: `   Round ended!\n\nSummary sent to ${channel}.`
        });
    } catch (err) {
        console.error(err);
        await interaction.editReply('  Error ending round.');
    }
}

async function resolveAllVulns(interaction) {
    await interaction.deferReply();

    try {
        const result = await Vulnerability.updateMany(
            { isReported: true, isResolved: false },
            {
                $set: {
                    isResolved: true,
                    is_resolved_date: new Date()
                }
            }
        );

        // Close all active exploits
        await Exploit.updateMany(
            { is_caught: false },
            { $set: { is_caught: true } }
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
        const reportedVulns = await Vulnerability.countDocuments({ isReported: true });
        const resolvedVulns = await Vulnerability.countDocuments({ isResolved: true });
        const totalReports = await Report.countDocuments();
        const totalExploits = await Exploit.countDocuments();
        const activeExploits = await Exploit.countDocuments({ is_caught: false });
        const totalCompanies = await Company.countDocuments();
        const totalRounds = await Round.countDocuments();

        const totalPayout = await Report.aggregate([
            { $group: { _id: null, total: { $sum: '$offered_amount' } } }
        ]);

        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Statistics')
            .setColor('#0099ff')
            .addFields(
                { name: '👥 Users', value: `${totalUsers}`, inline: true },
                { name: ' Companies', value: `${totalCompanies}`, inline: true },
                { name: 'Rounds', value: `${totalRounds}`, inline: true },
                { name: 'Total Vulnerabilities', value: `${totalVulns}`, inline: true },
                { name: 'Reported', value: `${reportedVulns}`, inline: true },
                { name: 'Resolved', value: `${resolvedVulns}`, inline: true },
                { name: 'Total Reports', value: `${totalReports}`, inline: true },
                { name: ' Total Exploits', value: `${totalExploits}`, inline: true },
                { name: ' Active Exploits', value: `${activeExploits}`, inline: true },
                { name: 'Total Payouts', value: `$${totalPayout[0]?.total || 0}`, inline: false }
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error(err);
        await interaction.editReply(' Error fetching statistics.');
    }
}

async function setAnnounceChannel(interaction) {
    await interaction.deferReply();

    try {
        const channel = interaction.options.getChannel('channel');

        // Store in environment or database
        process.env.ANNOUNCE_CHANNEL_ID = channel.id;

        await interaction.editReply({
            content: ` Announcement channel set to ${channel}.`
        });
    } catch (err) {
        console.error(err);
        await interaction.editReply(' Error setting channel.');
    }
}



async function listUsers(interaction) {
    await interaction.deferReply();

    try {
        const users = await User.find({}).sort({ money_earned: -1 }).limit(25);

        const embed = new EmbedBuilder()
            .setTitle('👥 Registered Users')
            .setColor('#00ff00')
            .setDescription(
                users.map((u, idx) =>
                    `${idx + 1}. **${u.discord_name}** - $${u.money_earned} - ${u.reports_made} reports`
                ).join('\n')
            )
            .setFooter({ text: `Total: ${await User.countDocuments()} users` });

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error(err);
        await interaction.editReply('Error listing users.');
    }
}

async function showLeaderboard(interaction) {
    await interaction.deferReply();

    try {
        const topEarners = await User.find({}).sort({ money_earned: -1 }).limit(10);
        const topReporters = await User.find({}).sort({ reports_made: -1 }).limit(10);
        const topReputation = await User.find({}).sort({ reputation_earned: -1 }).limit(10);

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

        await interaction.editReply({ embeds: [embed] });
    } catch (err) {
        console.error(err);
        await interaction.editReply('  Error generating leaderboard.');
    }
}
