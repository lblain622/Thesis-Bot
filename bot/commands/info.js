const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
    ButtonBuilder,
    ButtonStyle,
} = require('discord.js');
const Vulnerability = require('../../models/Vulnerabilities');
const User = require('../../models/Users');
const Company = require('../../models/Company');


module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
        .setDescription('View detailed information about a vulnerability')
        .addStringOption(option =>
            option.setName('identifier')
                .setDescription('Vulnerability identifier (e.g., XSS-ADMIN-001)')
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('reported')
                .setDescription('Filter by reported status')
                .addChoices(
                    {name: 'Reported', value: 'reported'},
                    {name: 'Unreported', value: 'unreported'},
                    {name: 'Any', value: 'any'}
                )
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('resolved')
                .setDescription('Filter by resolution status')
                .addChoices(
                    {name: 'Resolved', value: 'resolved'},
                    {name: 'Unresolved', value: 'unresolved'},
                    {name: 'Any', value: 'any'}
                )
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option.setName('exclude_self_reported')
                .setDescription('Exclude vulnerabilities you have reported')
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const user = await User.findOne({discord_id: interaction.user.id});
            if (!user) {
                return interaction.editReply({content: 'User not found.', flags: 64});
            }

            const now = new Date();
            const identifier = interaction.options.getString('identifier');
            let vulnerability;

            if (identifier) {
                vulnerability = await Vulnerability.findOne({vuln_identifier: identifier})
                    .populate('company_id')
                    .populate('reported_by.user_id');

                if (!vulnerability) {
                    return interaction.editReply({
                        content: `Vulnerability "${identifier}" not found.`,
                        flags: 64
                    });
                }

                // ----- FIX: Check if vulnerability is expired -----
                if (vulnerability.expiration_date && new Date(vulnerability.expiration_date) <= now) {
                    return interaction.editReply({
                        content: `❌ This vulnerability expired on ${formatDate(vulnerability.expiration_date)} and is no longer accessible.`,
                        flags: 64
                    });
                }
                // ----- END FIX -----

                // Check if user has access
                const hasAccess = (vulnerability.visibility?.allowedUsers || []).some(
                    u => u.toString() === user._id.toString()
                ) || vulnerability.visibility?.isGlobal || false;

                if (!hasAccess) {
                    return interaction.editReply({
                        content: `You don't have access to this vulnerability.`,
                        flags: 64
                    });
                }

            } else {
                // Build filters based on options
                const reportedFilter = interaction.options.getString('reported') || 'any';
                const resolvedFilter = interaction.options.getString('resolved') || 'unresolved';
                const excludeSelf = interaction.options.getBoolean('exclude_self_reported') || false;

                const query = {
                    $or: [
                        {'visibility.allowedUsers': user._id},
                        {'visibility.isGlobal': true}
                    ],
                    // ----- FIX: Exclude expired vulnerabilities from list -----
                    expiration_date: {$gt: now}
                    // ----- END FIX -----
                };

                if (reportedFilter !== 'any') {
                    query.isReported = (reportedFilter === 'reported');
                }

                if (resolvedFilter !== 'any') {
                    query.isResolved = (resolvedFilter === 'resolved');
                }

                if (excludeSelf) {
                    query.reported_by = {$not: {$elemMatch: {user_id: user._id}}};
                }

                const vulnerabilities = await Vulnerability.find(query)
                    .populate('company_id')
                    .populate('reported_by.user_id');

                if (!vulnerabilities.length) {
                    return interaction.editReply({
                        content: 'You have no active vulnerabilities to view.',
                        flags: 64
                    });
                }

                const selectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_vuln_info')
                    .setPlaceholder('Select a vulnerability to view details')
                    .addOptions(
                        vulnerabilities.slice(0, 25).map(v => {
                            const selfReported = Array.isArray(v.reported_by) && v.reported_by.some(rb => rb.user_id && rb.user_id._id && rb.user_id._id.toString() === user._id.toString());
                            const descParts = [
                                v.volun_type,
                                v.isReported ? 'Reported' : 'Unreported',
                                v.isResolved ? 'Resolved' : 'Unresolved'
                            ];
                            if (selfReported) descParts.push('You reported');
                            return ({
                                label: v.vuln_identifier,
                                description: descParts.join(' • '),
                                value: v._id.toString()
                            });
                        })
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
                    .populate('reported_by.user_id');

                // ----- FIX: Double-check expiration after selection -----
                if (vulnerability.expiration_date && new Date(vulnerability.expiration_date) <= now) {
                    await response.update({
                        content: `❌ This vulnerability expired on ${formatDate(vulnerability.expiration_date)} and is no longer accessible.`,
                        components: []
                    });
                    return;
                }
                // ----- END FIX -----

                await response.update({content: 'Loading vulnerability details...', components: []});
            }

            const canSeeFields = (vulnerability.visibility?.allowedUsers || []).some(
                u => u.toString() === user._id.toString()
            ) || vulnerability.visibility?.isGlobal || false;

            const embed = new EmbedBuilder()
                .setTitle(`${vulnerability.vuln_identifier}`)
                .setColor(canSeeFields ? getSeverityColor(vulnerability.severity) : '#808080')
                .setDescription(vulnerability.description || 'No description provided');

            // ----- FIX: Basic info with proper status display -----
            const isSelfReported = Array.isArray(vulnerability.reported_by) &&
                vulnerability.reported_by.some(rb => rb.user_id?._id?.toString() === user._id.toString());

            let statusEmoji = '🔍';
            let statusText = 'Unreported';

            if (vulnerability.isResolved) {
                statusEmoji = '✅';
                statusText = 'Resolved';
            } else if (vulnerability.isReported) {
                statusEmoji = '📝';
                statusText = 'Reported';
            }

            if (isSelfReported) {
                statusText += ' (You reported)';
            }

            embed.addFields({
                name: '📋 Basic Information',
                value: `**Company:** ${vulnerability.company_id?.name || 'Unknown'}\n` +
                    `**Type:** ${vulnerability.volun_type || 'Unknown'}\n` +
                    `**Status:** ${statusEmoji} ${statusText}`
            });
            const fieldAnalysis = buildFieldAnalysis(vulnerability, user);
            if (fieldAnalysis && fieldAnalysis.length > 0) {
                embed.addFields({
                    name: '🔍 Field Analysis',
                    value: fieldAnalysis
                });
            }

            if (canSeeFields && vulnerability.isReported && !vulnerability.isResolved) {
                const reporters = vulnerability.reported_by || [];
                if (reporters.length > 0) {
                    const reportersList = reporters.slice(0, 3).map(r => {
                        const reporterUser = r.user_id;
                        const isFirst = vulnerability.first_reporter?.toString() === reporterUser?._id.toString();
                        const isYou = reporterUser?._id?.toString() === user._id.toString();
                        let name = 'Unknown User';
                        if (reporterUser?.discord_name) {
                            name = reporterUser.discord_name;
                        }
                        if (isYou) {
                            name = '**You**';
                        }
                        return `${isFirst ? '🏆 ' : ''}${name}`;
                    }).join('\n');

                    embed.addFields({
                        name: `📢 Reported By (${reporters.length})`,
                        value: reportersList + (reporters.length > 3 ? `\n...and ${reporters.length - 3} more` : '')
                    });
                }
            }

            const actionRow = new ActionRowBuilder();

            if (canSeeFields && !vulnerability.isResolved) {
                // actionRow.addComponents(
                //     new ButtonBuilder()
                //         .setCustomId(`report_${vulnerability._id}`)
                //         .setLabel('Report This Vulnerability')
                //         .setStyle(ButtonStyle.Primary)
                //         .setEmoji('📝')
                //         .setDisabled(vulnerability.isReported || vulnerability.isResolved),
                //     new ButtonBuilder()
                //         .setCustomId(`submitpoc_${vulnerability._id}`)
                //         .setLabel('Submit POC')
                //         .setStyle(ButtonStyle.Secondary)
                //         .setEmoji('🔍')
                //         .setDisabled(vulnerability.isResolved)
                // );
            }
            // ----- END FIX -----

            await interaction.editReply({
                embeds: [embed],
                components: actionRow.components.length > 0 ? [actionRow] : [],
                flags: 64
            });

        } catch (err) {
            console.error('Info command error:', err);
            await interaction.editReply({
                content: 'An error occurred while fetching vulnerability information.',
                flags: 64
            });
        }
    },
};

function buildFieldAnalysis(vulnerability, user) {
    const fields = [];

    const fieldDefinitions = [
        {key: 'networkAccess', label: 'Network Access', icon: '🌐'},
        {key: 'arbitraryCodeExecution', label: 'Arbitrary Code Execution', icon: '⚙️'},
        {key: 'userInteraction', label: 'User Interaction Required', icon: '👤'},
        {key: 'automatable', label: 'Exploit Automation', icon: '🤖'},
        {key: 'privilegesRequired', label: 'Privileges Required', icon: '🔐'},
        {key: 'confidentialityImpact', label: 'Confidentiality Impact', icon: '📖'},
        {key: 'integrityImpact', label: 'Integrity Impact', icon: '✏️'},
        {key: 'availabilityImpact', label: 'Availability Impact', icon: '🛑'},
        {key: 'recoveryPotential', label: 'Recovery Potential', icon: '♻️'}
    ];

    for (const field of fieldDefinitions) {
        const fieldData = vulnerability[field.key];

        // Skip if field doesn't exist in the vulnerability
        if (!fieldData) continue;

        // Check if user can view this specific field
        const canView = fieldData.visibleTo?.some(
            id => id.toString() === user._id.toString()
        ) || false;

        let displayValue;
        if (canView && fieldData.answer) {
            displayValue = formatFieldAnswer(field.key, fieldData.answer);
        } else {
            displayValue = '❓ Unknown'; // Always show Unknown if not revealed
        }

        fields.push(`${field.icon} **${field.label}:** ${displayValue}`);
    }

    return fields.length > 0 ? fields.join('\n') : null;
}

function formatFieldAnswer(fieldKey, answer) {
    // Handle null/undefined/empty
    if (answer === undefined || answer === null || answer === '') {
        return 'Unknown';
    }

    // Y/N fields
    if (['networkAccess', 'arbitraryCodeExecution', 'userInteraction', 'automatable'].includes(fieldKey)) {
        if (answer === 'Yes') return '✅ Yes';
        if (answer === 'No') return '❌ No';
        return '❓ Unknown';
    }

    // Privileges Required
    if (fieldKey === 'privilegesRequired') {
        const map = {
            'None': '🟢 None',
            'Low': '🟡 Low',
            'High': '🔴 High'
        };
        return map[answer] || '❓ Unknown';
    }

    // Recovery Potential
    if (fieldKey === 'recoveryPotential') {
        const map = {
            'Automatic': '🟢 Automatic',
            'User': '🟡 User Intervention',
            'Irrecoverable': '🔴 Irrecoverable'
        };
        return map[answer] || '❓ Unknown';
    }

    // CIA Impacts
    if (['confidentialityImpact', 'integrityImpact', 'availabilityImpact'].includes(fieldKey)) {
        const map = {
            'None': '⚪ None',
            'Low': '🟡 Low',
            'Medium': '🟠 Medium',
            'High': '🔴 High'
        };
        return map[answer] || '❓ Unknown';
    }

    return answer.toString() || 'Unknown';
}

function getSeverityColor(severity) {
    const colors = {
        'LOW': '#0D9373',
        'MEDIUM': '#FFA500',
        'HIGH': '#FF6347',
        'CRITICAL': '#8B0000'
    };
    return colors[severity?.toUpperCase()] || '#808080';
}

function getSeverityEmoji(severity) {
    const emojis = {
        'LOW': '🟢',
        'MEDIUM': '🟡',
        'HIGH': '🟠',
        'CRITICAL': '🔴'
    };
    return emojis[severity?.toUpperCase()] || '⚪';
}

function formatDate(date) {
    return new Date(date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
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
        await message.edit({content: 'Selection timed out.', components: []}).catch(console.error);
        return null;
    }
}