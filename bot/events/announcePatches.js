// bot/utils/announcements.js
const { EmbedBuilder } = require('discord.js');
const Vulnerability = require('../../models/Volunerabilies');
const User = require('../../models/Users');
const Company = require('../../models/Company');
const Report = require('../../models/Reports');

/**
 * Announce when a vulnerability is discovered and patched
 */
async function announceVulnerabilityPatched(client, vulnerability, acceptedOffer, channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        const company = await Company.findById(vulnerability.company_id);
        const reporter = await User.findById(acceptedOffer.user_id || vulnerability.first_reporter);

        const embed = new EmbedBuilder()
            .setTitle('Vulnerability Discovered & Patched!')
            .setColor('#00FF00')
            .setDescription(
                `**${vulnerability.vuln_identifier}** has been discovered and patched!\n\n` +
                `A security researcher has identified and reported a vulnerability to **${company?.name || 'Unknown Company'}**.`
            )
            .addFields(
                { name: 'Company', value: company?.name || 'Unknown', inline: true },
                { name: 'Severity', value: vulnerability.severity, inline: true },
                { name: 'Type', value: vulnerability.volun_type, inline: true },
                { name: 'Reward', value: `$${acceptedOffer.offered_amount}`, inline: true },
                { name: 'Reporter', value: reporter?.discord_name || 'Anonymous', inline: true },
                { name: 'CVSS Score', value: `${vulnerability.cvss_score || 'N/A'}`, inline: true }
            )
            .setFooter({ text: 'Keep hunting for vulnerabilities! Use /report to submit your findings.' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error announcing vulnerability patch:', err);
    }
}

/**
 * Announce multiple discoveries in a batch (for efficiency)
 */
async function announceBatchPatches(client, vulnerabilities, channelId) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) return;

        if (vulnerabilities.length === 0) return;

        const embed = new EmbedBuilder()
            .setTitle(' Multiple Vulnerabilities Patched!')
            .setColor('#00FF00')
            .setDescription(
                `**${vulnerabilities.length} vulnerabilities** have been discovered and patched today!\n\n` +
                `Security researchers have made our platforms more secure.`
            )
            .setFooter({ text: 'Great work, security researchers!' })
            .setTimestamp();

        // Add each vulnerability as a field (max 25)
        for (const vuln of vulnerabilities.slice(0, 25)) {
            const company = await Company.findById(vuln.company_id);
            embed.addFields({
                name: `${vuln.vuln_identifier}`,
                value: `${company?.name || 'Unknown'} - ${vuln.severity} - $${vuln.reward || 0}`,
                inline: true
            });
        }

        if (vulnerabilities.length > 25) {
            embed.addFields({
                name: '...',
                value: `And ${vulnerabilities.length - 25} more!`,
                inline: false
            });
        }

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error('Error announcing batch patches:', err);
    }
}

module.exports = {
    announceVulnerabilityPatched,
    announceBatchPatches
};