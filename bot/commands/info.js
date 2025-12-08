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

//TODO: looking into UI improvements with this
// info works as intened but I feel like it could work better for a better user experience
// maybe filetering such as reported/reolved vs unreport/unresolved
module.exports = {
    data: new SlashCommandBuilder()
        .setName('info')
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

                vulnerability = await Vulnerability.findOne({ vuln_identifier: identifier })
                    .populate('company_id')
                    .populate('reported_by.user_id');

                if (!vulnerability) {
                    return interaction.editReply({
                        content: `Vulnerability "${identifier}" not found.`,
                        flags: 64
                    });
                }

                // Check if user has access
                const hasAccess = vulnerability.visibility.allowedUsers.some(
                    u => u.toString() === user._id.toString()
                ) || vulnerability.visibility.isGlobal;

                if (!hasAccess) {
                    return interaction.editReply({
                        content: `You don't have access to this vulnerability.`,
                        flags: 64
                    });
                }

            } else {

                const vulnerabilities = await Vulnerability.find({
                    $or: [
                        { 'visibility.allowedUsers': user._id },
                        { 'visibility.isGlobal': true }
                    ],
                    $and:[{'isResolved':false}]
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
                            description: `${v.volun_type} - ${v.isReported ? 'Reported' : 'Unreported'}`,
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
                    .populate('reported_by.user_id');

                await response.update({ content: 'Loading vulnerability details...', components: [] });
            }

            const canSeeFields = vulnerability.visibility.allowedUsers.some(
                u => u.toString() === user._id.toString()
            );
            const embed = new EmbedBuilder()
                .setTitle(`${vulnerability.vuln_identifier}`)
                .setColor(canSeeFields ? getSeverityColor(vulnerability.severity) : '#808080')
                .setDescription(vulnerability.description || 'No description provided');


            embed.addFields({
                name: '📋 Basic Information',
                value: `**Company:** ${vulnerability.company_id?.name || 'Unknown'}\n` +
                    `**Type:** ${vulnerability.volun_type}\n` +
                    `**Status:** ${vulnerability.isResolved ? '✅ Resolved' : vulnerability.isReported ? ' Reported' : 'Unreported'}`
            });

            // Field Analysis - only show if user can see
            if (canSeeFields) {
                const fieldAnalysis = buildFieldAnalysis(vulnerability,user);
                if (fieldAnalysis) {
                    embed.addFields({
                        name: '🔍 Field Analysis',
                        value: fieldAnalysis
                    });
                }

                embed.addFields({
                    name: 'Fields Unknown',
                    value: 'Submit a **Report** or **POC** to reveal vulnerability details and field analysis.'
                });

            }

            // Report Information
            const reporters = vulnerability.reported_by || [];
            if (reporters.length > 0 && canSeeFields) {
                const reportersList = reporters.slice(0, 3).map(r => {
                    const reporterUser = r.user_id;
                    const isFirst = vulnerability.first_reporter?.toString() === reporterUser?._id.toString();
                    return `${isFirst ? '🏆 ' : ''}${reporterUser?.discord_name || 'Unknown'}`;
                }).join('\n');

                embed.addFields({
                    name: ` Reported By (${reporters.length})`,
                    value: reportersList + (reporters.length > 3 ? `\n...and ${reporters.length - 3} more` : '')
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
function buildFieldAnalysis(vulnerability, user) {
    const fields = [];

    const fieldDefinitions = [
        { key: 'networkAccess', label: 'Network Access', icon: '🌐' },
        { key: 'arbitraryCodeExecution', label: 'Arbitrary Code Execution', icon: '⚙️' },
        { key: 'userInteraction', label: 'User Interaction Required', icon: '👤' },
        { key: 'automatable', label: 'Exploit Automation', icon: '🤖' },
        { key: 'privilegesRequired', label: 'Privileges Required', icon: '🔐' },
        { key: 'confidentialityImpact', label: 'Confidentiality Impact', icon: '📖' },
        { key: 'integrityImpact', label: 'Integrity Impact', icon: '✏️' },
        { key: 'availabilityImpact', label: 'Availability Impact', icon: '🛑' },
        { key: 'recoveryPotential', label: 'Recovery Potential', icon: '♻️' }
    ];

    for (const field of fieldDefinitions) {
        const fieldData = vulnerability[field.key];

        if (!fieldData) continue;

        //  Use the actual visibleTo array inside the vulnerability
        const canView = fieldData.visibleTo?.some(
            u => u.toString() === user._id.toString()
        ) || false;

        const displayValue = canView
            ? formatFieldAnswer(field.key, fieldData.answer)
            : formatFieldAnswer(field.key, 'Unknown');

        fields.push(`${field.icon} **${field.label}:** ${displayValue}`);
    }

    return fields.length > 0 ? fields.join('\n') : null;
}

function formatFieldAnswer(fieldKey, answer) {
    // Y/N fields
    if (['networkAccess', 'arbitraryCodeExecution', 'userInteraction', 'automatable'].includes(fieldKey)) {
        return answer === 'Yes' ? '✅ Yes' : '❌ No';
    }

    // Privileges Required
    if (fieldKey === 'privilegesRequired') {
        const map = {
            'None': '🟢 None',
            'Low': '🟡 Low',
            'High': '🔴 High'
        };
        return map[answer] || answer;
    }

    // Recovery Potential
    if (fieldKey === 'recoveryPotential') {
        const map = {
            'Automatic': '🟢 Automatic',
            'User': '🟡 User Intervention',
            'Irrecoverable': '🔴 Irrecoverable'
        };
        return map[answer] || answer;
    }

    // CIA Impacts
    if (['confidentialityImpact', 'integrityImpact', 'availabilityImpact'].includes(fieldKey)) {
        const map = {
            'None': '⚪ None',
            'Low': '🟡 Low',
            'Medium': '🟠 Medium',
            'High': '🔴 High'
        };
        return map[answer] || answer;
    }

    return answer;
}

function getSeverityColor(severity) {
    const colors = {
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