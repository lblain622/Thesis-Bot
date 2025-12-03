// bot/utils/announcements.js
const { EmbedBuilder } = require('discord.js');
const Vulnerability = require('../../models/Volunerabilies');
const User = require('../../models/Users');
const Company = require('../../models/Company');
const Report = require('../../models/Reports');

/**
 * Announce when a vulnerability is discovered and patched
 */
async function announceVulnerabilityPatched(client, vulnerability, acceptedOffer, serverId) {
    try {
        // Find the server/guild
        const guild = await client.guilds.fetch(serverId);
        if (!guild) {
            console.error('Guild not found:', serverId);
            return;
        }

        // Find the general channel (usually named "general")
        let channel = guild.channels.cache.find(ch =>
            ch.type === 0 && // GuildText type
            ch.name.toLowerCase().includes('general')
        );

        // If no general channel, try to find the first text channel
        if (!channel) {
            const textChannels = guild.channels.cache.filter(ch => ch.type === 0);
            if (textChannels.size === 0) {
                console.error('No text channels found in guild:', guild.name);
                return;
            }
            channel = textChannels.first();
        }

        const company = await Company.findById(vulnerability.company_id);
        const reporter = await User.findById(acceptedOffer.user_id || vulnerability.first_reporter);

        // Try to get Discord user for mention
        let reporterMention = reporter?.discord_name || 'Anonymous';
        if (reporter?.discord_id) {
            try {
                const discordUser = await client.users.fetch(reporter.discord_id);
                reporterMention = `<@${discordUser.id}>`;
            } catch (err) {
                // If can't fetch user, use the stored name
                console.error('Could not fetch Discord user:', err);
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('🚨 Vulnerability Discovered & Patched!')
            .setColor('#00FF00')
            .setDescription(
                `**${vulnerability.vuln_identifier}** has been discovered and patched!\n\n` +
                `A security researcher has identified and reported a vulnerability to **${company?.name || 'Unknown Company'}**.`
            )
            .addFields(
                { name: 'Company', value: company?.name || 'Unknown', inline: true },
                { name: 'Type', value: vulnerability.volun_type, inline: true },
                { name: 'Reward', value: `$${acceptedOffer.offered_amount || '0'}`, inline: true },
                { name: 'Reporter', value: reporterMention, inline: true },
                { name: 'Status', value: 'atched', inline: true }
            )
            .setFooter({ text: 'Keep hunting for vulnerabilities! Use /report to submit your findings.' })
            .setTimestamp();

        await channel.send({
            content: `🎉 New vulnerability patch announced!`,
            embeds: [embed]
        });
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