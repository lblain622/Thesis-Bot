/**
 * Utility for sending announcements to configured server channels instead of DMs
 */
const AnnouncementChannels = require('../../models/AnnouncementChannels');

/**
 * Get the configured channel for a specific announcement type
 * Falls back to default channel finding logic if not configured
 */
async function getAnnouncementChannel(client, guild, announcementType = 'general') {
    try {
        if (!guild) return null;

        // Try to get configured channel
        const config = await AnnouncementChannels.findOne({ guild_id: guild.id });
        let channelId = null;

        if (config && config.channels[announcementType]) {
            channelId = config.channels[announcementType];
        }

        if (channelId) {
            try {
                const channel = await guild.channels.fetch(channelId);
                if (channel && channel.isTextBased()) {
                    return channel;
                }
            } catch (err) {
                console.error(`Configured channel ${channelId} not found or not accessible:`, err);
            }
        }

        // Fallback: Find default channel
        return findDefaultChannel(guild);
    } catch (err) {
        console.error('Error getting announcement channel:', err);
        return null;
    }
}

/**
 * Find a default channel (general or first text channel)
 */
function findDefaultChannel(guild) {
    // Try to find 'general' channel first
    let channel = guild.channels.cache.find(ch =>
        ch.type === 0 && // GuildText type
        ch.name.toLowerCase().includes('general')
    );

    // If no general channel, try to find the first text channel
    if (!channel) {
        const textChannels = guild.channels.cache.filter(ch => ch.type === 0);
        if (textChannels.size > 0) {
            channel = textChannels.first();
        }
    }

    return channel || null;
}

/**
 * Post announcement to server channel instead of DM
 * @param {Client} client - Discord client
 * @param {User} discordUser - The user to notify (for context)
 * @param {Guild} guild - The guild to post to
 * @param {String|MessagePayload|WebhookMessageOptions} message - The message to send
 * @param {String} announcementType - Type of announcement (for channel routing)
 */
async function postAnnouncementToChannel(client, discordUser, guild, message, announcementType = 'general') {
    try {
        const channel = await getAnnouncementChannel(client, guild, announcementType);

        if (!channel) {
            console.error(`No announcement channel found for guild ${guild.id}`);
            return null;
        }

        // Mention the user in the message for context
        if (discordUser && typeof message === 'object' && !message.mentions?.users?.has(discordUser.id)) {
            if (!message.content) {
                message.content = '';
            }
            // Add mention at the beginning or end depending on preference
            message.content = `${message.content} (${discordUser})`.trim();
        }

        return await channel.send(message);
    } catch (err) {
        console.error('Error posting announcement to channel:', err);
        return null;
    }
}

/**
 * Post a private trade notification to user (DM or ephemeral)
 */
async function postTradeNotification(client, targetUser, guild, messageContent, messageOptions = {}) {
    try {
        return await targetUser.send({
            content: messageContent,
            ...messageOptions
        });
    } catch (err) {
        console.error('Error sending private trade notification:', err);
        return null;
    }
}

/**
 * Post a private offer notification to user (DM)
 */
async function postOfferNotification(client, targetUser, guild, embedOrContent, announcementType = 'offers') {
    try {
        return await targetUser.send(embedOrContent);
    } catch (err) {
        console.error('Error sending private offer notification:', err);
        return null;
    }
}

/**
 * Post a public summary to channel (for audit trail) without revealing full details
 */
async function postAnnouncement(client, guild, announcement, announcementType = 'general') {
    return postAnnouncementToChannel(client, null, guild, announcement, announcementType);
}

/**
 * Set up announcement channel configuration for a guild
 */
async function configureAnnouncementChannels(guildId, channelsConfig) {
    try {
        const config = await AnnouncementChannels.findOneAndUpdate(
            { guild_id: guildId },
            {
                guild_id: guildId,
                $set: { channels: channelsConfig },
                updated_at: new Date()
            },
            { upsert: true, new: true }
        );
        return config;
    } catch (err) {
        console.error('Error configuring announcement channels:', err);
        throw err;
    }
}

/**
 * Get current announcement channel configuration for a guild
 */
async function getAnnouncementChannelConfig(guildId) {
    try {
        return await AnnouncementChannels.findOne({ guild_id: guildId });
    } catch (err) {
        console.error('Error getting announcement channel config:', err);
        return null;
    }
}

module.exports = {
    getAnnouncementChannel,
    findDefaultChannel,
    postAnnouncementToChannel,
    postTradeNotification,
    postOfferNotification,
    postAnnouncement,
    configureAnnouncementChannels,
    getAnnouncementChannelConfig
};
