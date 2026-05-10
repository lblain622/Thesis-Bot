const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/Users');
const Vulnerability = require('../../models/Vulnerabilities');
const Report = require('../../models/Reports');
const Exploit = require('../../models/Exploit');

// We don't need ensureUserExists here; we'll create the user record if missing.

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Show summary of vulnerabilities you have interacted with'),
    async execute(interaction) {
        try {
            let userDoc = await User.findOne({ discord_id: interaction.user.id });

            // Get all vulnerabilities the user has reported
            const reportedVulns = await Report.find({ user_id: userDoc._id })
                .populate('vulnerability_id')
                .populate('company_id')
                .lean();

            // Get all vulnerabilities the user is currently exploiting
            const activeExploits = await Exploit.find({
                user_id: userDoc._id,
                status: 'Active'
            }).populate('volunerability_id').lean();

            // Get all vulnerabilities the user has discovered
            const discoveredVulns = await Vulnerability.find({
                'discovered_by.user_id': userDoc._id
            }).populate('company_id').lean();

            // Combine and deduplicate vulnerabilities
            const vulnMap = new Map();

            // Add reported vulnerabilities
            reportedVulns.forEach(report => {
                if (report.vulnerability_id) {
                    const vuln = report.vulnerability_id;
                    vulnMap.set(vuln._id.toString(), {
                        vuln: vuln,
                        status: vuln.isReported ? 'Reported' : 'Unreported',
                        reported: true,
                        exploiting: false,
                        moneyPerMin: null
                    });
                }
            });

            // Add exploited vulnerabilities
            activeExploits.forEach(exploit => {
                if (exploit.volunerability_id) {
                    const vulnId = exploit.volunerability_id._id.toString();
                    const existing = vulnMap.get(vulnId);
                    if (existing) {
                        existing.exploiting = true;
                        existing.moneyPerMin = exploit.money_per_cycle;
                        existing.status = 'Exploiting';
                    } else {
                        vulnMap.set(vulnId, {
                            vuln: exploit.volunerability_id,
                            status: 'Exploiting',
                            reported: false,
                            exploiting: true,
                            moneyPerMin: exploit.money_per_cycle
                        });
                    }
                }
            });

            // Add discovered but not reported/exploited vulnerabilities
            discoveredVulns.forEach(vuln => {
                const vulnId = vuln._id.toString();
                if (!vulnMap.has(vulnId)) {
                    vulnMap.set(vulnId, {
                        vuln: vuln,
                        status: 'Unreported',
                        reported: false,
                        exploiting: false,
                        moneyPerMin: null
                    });
                }
            });

            if (vulnMap.size === 0) {
                return interaction.reply({
                    content: 'You haven\'t interacted with any vulnerabilities yet. Try `/search` to find some!',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username}'s Vulnerability Summary`)
                .setDescription('Vulnerabilities you have discovered, reported, or are exploiting:');

            // Sort by status priority: Exploiting > Reported > Unreported
            const sortedVulns = Array.from(vulnMap.values()).sort((a, b) => {
                const statusOrder = { 'Exploiting': 0, 'Reported': 1, 'Unreported': 2 };
                return statusOrder[a.status] - statusOrder[b.status];
            });

            sortedVulns.slice(0, 10).forEach(item => {
                const { vuln, status, moneyPerMin } = item;
                const companyName = vuln.company_id?.name || 'Unknown Company';
                const moneyDisplay = moneyPerMin ? `$${moneyPerMin}/min` : '$???/min';

                embed.addFields({
                    name: `${vuln.vuln_identifier} - ${companyName}`,
                    value: `${status} - ${moneyDisplay}`,
                    inline: false
                });
            });

            if (vulnMap.size > 10) {
                embed.setFooter({ text: `Showing 10 of ${vulnMap.size} vulnerabilities` });
            }

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error('Summary command error:', err);
            if (!interaction.replied) {
                await interaction.reply({ content: 'Failed to retrieve vulnerability summary.', ephemeral: true });
            }
        }
    },
};
