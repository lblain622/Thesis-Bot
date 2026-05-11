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
const Exploit = require('../../models/Exploit');


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
        )
        .addStringOption(option =>
            option.setName('exploited')
                .setDescription('Filter by exploitation status')
                .addChoices(
                    {name: 'Exploited', value: 'exploited'},
                    {name: 'Not Exploited', value: 'not_exploited'},
                    {name: 'Any', value: 'any'}
                )
                .setRequired(false)
        ),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const user = await User.findOne({discord_id: interaction.user.id});
            if (!user) {
                return interaction.editReply({content: 'User not found.', flags: 64});
            }

            const identifier = interaction.options.getString('identifier');
            let vulnerability;

            // gather user's active exploits to apply filters/warnings
            const activeExploits = await Exploit.find({
                user_id: user._id,
                status: 'Active'
            }).lean();
            const exploitedIds = new Set(activeExploits.map(e => e.volunerability_id.toString()));

            if (identifier) {

                vulnerability = await Vulnerability.findOne({vuln_identifier: identifier})
                    .populate('company_id')
                    .populate('reported_by.user_id');

                // warn if exploiting
                const isExploiting = exploitedIds.has(vulnerability._id.toString());
                if (isExploiting) {
                    // append warning to description so it appears in embed later
                    vulnerability.description =
                        `⚠️ **You are currently exploiting this vulnerability!**\n\n` +
                        (vulnerability.description || '');
                }

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

                // Build filters based on options
                const reportedFilter = interaction.options.getString('reported') || 'any';
                const resolvedFilter = interaction.options.getString('resolved') || 'unresolved'; // default keeps previous behavior
                const excludeSelf = interaction.options.getBoolean('exclude_self_reported') || false;
                const exploitedFilter = interaction.options.getString('exploited') || 'any';

                const query = {
                    $or: [
                        {'visibility.allowedUsers': user._id},
                        {'visibility.isGlobal': true}
                    ]
                };

                if (exploitedFilter !== 'any') {
                    // we'll filter after we fetch since query uses ids
                }
                if (reportedFilter !== 'any') {
                    query.isReported = (reportedFilter === 'reported');
                }

                if (resolvedFilter !== 'any') {
                    query.isResolved = (resolvedFilter === 'resolved');
                }

                if (excludeSelf) {
                    // Exclude vulnerabilities where current user is among reporters
                    query.reported_by = {$not: {$elemMatch: {user_id: user._id}}};
                }

                let vulnerabilities = await Vulnerability.find(query)
                    .populate('company_id')
                    .populate('reported_by.user_id');

                // apply exploitation filter if requested
                if (exploitedFilter === 'exploited') {
                    vulnerabilities = vulnerabilities.filter(v => exploitedIds.has(v._id.toString()));
                } else if (exploitedFilter === 'not_exploited') {
                    vulnerabilities = vulnerabilities.filter(v => !exploitedIds.has(v._id.toString()));
                }
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
                        vulnerabilities.slice(0, 25).map(v => {
                            const selfReported = Array.isArray(v.reported_by) && v.reported_by.some(rb => rb.user_id && rb.user_id._id && rb.user_id._id.toString() === user._id.toString());
                            const exploited = exploitedIds.has(v._id.toString());
                            const descParts = [
                                v.volun_type,
                                v.isReported ? 'Reported' : 'Unreported',
                                v.isResolved ? 'Resolved' : 'Unresolved'
                            ];
                            if (selfReported) descParts.push('You reported');
                            if (exploited) descParts.push('Exploiting');
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

                const response = await this.waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_vuln_info');
                if (!response) return;

                vulnerability = await Vulnerability.findById(response.values[0])
                    .populate('company_id')
                    .populate('reported_by.user_id');

                await response.update({content: 'Loading vulnerability details...', components: []});
            }

            const vulIdString = vulnerability._id.toString();
            const canSeeFields = vulnerability.visibility.allowedUsers.some(
                u => u.toString() === user._id.toString()
            );
            const isExploitingFinal = exploitedIds.has(vulIdString);

            const embed = new EmbedBuilder()
                .setTitle(`${vulnerability.vuln_identifier}`)
                .setColor('#3498db')
                .setDescription(vulnerability.description || 'No description provided');

            if (isExploitingFinal) {
                embed.addFields({
                    name: '⚠️ Currently Exploiting',
                    value: 'You are actively exploiting this vulnerability – reporting it or collecting earnings may increase your chance of getting caught.'
                });
            }


            embed.addFields({
                name: '📋 Basic Information',
                value: `**Type:** ${vulnerability.volun_type}\n` +
                    `**Status:** ${vulnerability.isResolved ? '✅ Resolved' : vulnerability.isReported ? ' Reported' : 'Unreported'}`
            });

            const actionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`report_${vulnerability._id}`)
                        .setLabel('Report This Vulnerability')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('📝')
                );
            // Field Analysis - only show if user can see
            if (canSeeFields) {
                const fieldAnalysis = this.buildFieldAnalysis(vulnerability, user);
                if (fieldAnalysis) {
                    embed.addFields({
                        name: '🔍 Field Analysis',
                        value: fieldAnalysis
                    });
                }

                embed.addFields({
                    name: 'Fields Unknown',
                    value: 'Submit a **Report** to reveal vulnerability details and field analysis.'
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

            embed.setFooter({text: `Vulnerability ID: ${vulnerability._id}`});
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

    buildFieldAnalysis: function(vulnerability, user) {
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

            if (!fieldData) continue;


            const canView = fieldData.visibleTo?.some(
                u => u.toString() === user._id.toString()
            ) || false;

            const displayValue = this.formatFieldAnswer(field.key, fieldData.answer);

            fields.push(`${field.icon} **${field.label}:** ${displayValue}`);
        }

        return fields.length > 0 ? fields.join('\n') : null;
    },

    formatFieldAnswer: function(fieldKey, answer) {
        // Fallback for missing/undefined values
        if (answer === undefined || answer === null || answer === '') {
            return 'Unknown';
        }
        // Y/N fields
        if (['networkAccess', 'arbitraryCodeExecution', 'userInteraction', 'automatable'].includes(fieldKey)) {
            if (answer === 'Yes') return '✅ Yes';
            if (answer === 'No') return '❌ No';
            return 'Unknown';
        }

        // Privileges Required
        if (fieldKey === 'privilegesRequired') {
            const map = {
                'None': '🟢 None',
                'Low': '🟡 Low',
                'High': '🔴 High'
            };
            return map[answer] || 'Unknown';
        }

        // Recovery Potential
        if (fieldKey === 'recoveryPotential') {
            const map = {
                'Automatic': '🟢 Automatic',
                'User': '🟡 User Intervention',
                'Irrecoverable': '🔴 Irrecoverable'
            };
            return map[answer] || 'Unknown';
        }

        // CIA Impacts
        if (['confidentialityImpact', 'integrityImpact', 'availabilityImpact'].includes(fieldKey)) {
            const map = {
                'None': '⚪ None',
                'Low': '🟡 Low',
                'Medium': '🟠 Medium',
                'High': '🔴 High'
            };
            return map[answer] || 'Unknown';
        }

        return typeof answer === 'string' && answer.trim() ? answer : 'Unknown';
    },

    waitForComponent: async function(message, userId, componentType, customIds, time = 120000) {
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
    },
};
