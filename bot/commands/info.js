const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType
} = require('discord.js');
const Vulnerability = require('../../models/Volunerabilies');
const User = require('../../models/Users');
const Company = require('../../models/Company');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vulninfo')
        .setDescription('View detailed information about a vulnerability')
        .addStringOption(option =>
            option.setName('identifier')
                .setDescription('Vulnerability identifier (e.g., XSS-ADMIN-001)')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const user = await User.findOne({ discord_id: interaction.user.id });
            if (!user) {
                return interaction.editReply({ content: 'User not found.', flags: 64 });
            }

            const identifier = interaction.options.getString('identifier');

            let vulnerability;
            if (identifier) {
                // Look up specific vulnerability
                vulnerability = await Vulnerability.findOne({ vuln_identifier: identifier })
                    .populate('company_id')
                    .populate('first_reporter')
                    .populate('reported_by.user_id')
                    .populate('pocs_submitted.user_id')
                    .populate('discovered_by.user_id');

                if (!vulnerability) {
                    return interaction.editReply({
                        content: ` Vulnerability "${identifier}" not found.`,
                        flags: 64
                    });
                }

                // Check if user has access
                const hasAccess = vulnerability.visibility.allowedUsers.some(
                    u => u.toString() === user._id.toString()
                ) || vulnerability.visibility.isGlobal;

                if (!hasAccess) {
                    return interaction.editReply({
                        content: ` You don't have access to this vulnerability.`,
                        flags: 64
                    });
                }

            } else {
                // Show list of user's vulnerabilities
                const vulnerabilities = await Vulnerability.find({
                    $or: [
                        { 'visibility.allowedUsers': user._id },
                        { 'visibility.isGlobal': true }
                    ]
                }).populate('company_id');

                if (!vulnerabilities.length) {
                    return interaction.editReply({
                        content: 'You have no vulnerabilities to view.',
                        flags: 64
                    });
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_vuln_info')
                    .setPlaceholder('Select a vulnerability to view details')
                    .addOptions(
                        vulnerabilities.slice(0, 25).map(v => ({
                            label: v.vuln_identifier,
                            description: `${v.severity} - ${v.volun_type} - ${v.isReported ? 'Reported' : 'Unreported'}`,
                            value: v._id.toString()
                        }))
                    );

                const row = new ActionRowBuilder().addComponents(selectMenu);
                const message = await interaction.editReply({
                    content: 'Select a vulnerability to view details:',
                    components: [row],
                    fetchReply: true
                });

                const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_vuln_info');
                if (!response) return;

                vulnerability = await Vulnerability.findById(response.values[0])
                    .populate('company_id')
                    .populate('first_reporter')
                    .populate('reported_by.user_id')
                    .populate('pocs_submitted.user_id')
                    .populate('discovered_by.user_id');

                await response.update({ content: 'Loading vulnerability details...', components: [] });
            }

            // Build detailed embed
            const embed = new EmbedBuilder()
                .setTitle(`${vulnerability.vuln_identifier}`)
                .setColor(getSeverityColor(vulnerability.severity))
                .setDescription(vulnerability.description || 'No description provided');

            // Basic Information
            embed.addFields({
                name: '? Basic Information',
                value:
                    `**Company:** ${vulnerability.company_id?.name || 'Unknown'}\n` +
                    `**Type:** ${vulnerability.volun_type}\n` +
                    `**Severity:** ${vulnerability.severity}\n` +
                    `**CVSS Score:** ${vulnerability.cvss_score || 'N/A'}\n` +
                    `**Status:** ${vulnerability.isResolved ? 'Resolved' : vulnerability.isReported ? ' Reported' : 'Unreported'}`
            });

            // Discovery Information
            const discoverers = vulnerability.discovered_by || [];
            if (discoverers.length > 0) {
                const discoverersList = discoverers.map((d, idx) => {
                    const user = d.user_id;
                    const isFirst = idx === 0;
                    return `${isFirst ? '🏆 ' : ''}${user?.discord_name || 'Unknown'} (${new Date(d.discovered_at).toLocaleDateString()})`;
                }).join('\n');

                embed.addFields({
                    name: 'Discovered By',
                    value: discoverersList || 'Unknown',
                    inline: true
                });
            }

            // POC Information
            const pocCount = vulnerability.pocs_submitted?.length || 0;
            if (pocCount > 0) {
                const pocList = vulnerability.pocs_submitted.slice(0, 3).map(poc => {
                    const user = poc.user_id;
                    return `${user?.discord_name || 'Unknown'} (${new Date(poc.submitted_at).toLocaleDateString()})`;
                }).join('\n');

                embed.addFields({
                    name: `POCs Submitted (${pocCount})`,
                    value: pocList + (pocCount > 3 ? `\n...and ${pocCount - 3} more` : ''),
                    inline: true
                });
            }

            // Report Information
            const reporters = vulnerability.reported_by || [];
            if (reporters.length > 0) {
                const reportersList = reporters.slice(0, 3).map(r => {
                    const user = r.user_id;
                    const isFirst = vulnerability.first_reporter?.toString() === user?._id.toString();
                    return `${isFirst ? '🏆 ' : ''}${user?.discord_name || 'Unknown'} (${new Date(r.reported_at).toLocaleDateString()})`;
                }).join('\n');

                embed.addFields({
                    name: `Reported By (${reporters.length})`,
                    value: reportersList + (reporters.length > 3 ? `\n...and ${reporters.length - 3} more` : '')
                });
            }

            // Timeline
            const timeline = [];
            if (vulnerability.first_reported_at) {
                timeline.push(`**First Report:** ${new Date(vulnerability.first_reported_at).toLocaleDateString()}`);
            }
            if (vulnerability.reported_date) {
                timeline.push(`**Last Report:** ${new Date(vulnerability.reported_date).toLocaleDateString()}`);
            }
            if (vulnerability.is_resolved_date) {
                timeline.push(`**Resolved:** ${new Date(vulnerability.is_resolved_date).toLocaleDateString()}`);
            }

            if (timeline.length > 0) {
                embed.addFields({
                    name: '📅 Timeline',
                    value: timeline.join('\n')
                });
            }

            // Access Information
            const accessCount = vulnerability.visibility.allowedUsers?.length || 0;
            embed.addFields({
                name: ' Access',
                value: vulnerability.visibility.isGlobal
                    ? 'Global (Everyone can see)'
                    : ` Private (${accessCount} user${accessCount !== 1 ? 's' : ''} have access)`
            });

            // CVSS Vector if available
            if (vulnerability.cvss_vector) {
                embed.addFields({
                    name: ' CVSS Vector',
                    value: `\`${vulnerability.cvss_vector}\``
                });
            }

            embed.setFooter({ text: `Vulnerability ID: ${vulnerability._id}` });
            embed.setTimestamp(vulnerability.createdAt);

            await interaction.editReply({
                embeds: [embed],
                flags: 64
            });

        } catch (err) {
            console.error(err);
            await interaction.editReply({
                content: 'An error occurred while fetching vulnerability information.',
                flags: 64
            });
        }
    },
};

function getSeverityColor(severity) {
    const colors = {
        'None': '#808080',
        'Low': '#0D9373',
        'Medium': '#FFA500',
        'High': '#FF6347',
        'Critical': '#8B0000'
    };
    return colors[severity] || '#808080';
}

async function waitForComponent(message, userId, componentType, customIds, time = 120000) {
    try {
        return await message.awaitMessageComponent({
            componentType,
            filter: i => {
                const isCorrectUser = i.user.id === userId;
                const isCorrectComponent = Array.isArray(customIds)
                    ? customIds.includes(i.customId)
                    : i.customId === customIds;
                return isCorrectUser && isCorrectComponent;
            },
            time
        });
    } catch (error) {
        console.error('Component wait error:', error);
        await message.edit({ content: 'Selection timed out.', components: [] }).catch(console.error);
        return null;
    }
}