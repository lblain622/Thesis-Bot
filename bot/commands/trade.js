const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const User = require('../../models/Users');
const Vulnerability = require('../../models/Vulnerabilities');
const Trade = require('../../models/Trades');
const {postAnnouncement} = require('../utils/announcementUtils');

//TODO: Ensure Trading works correctly
module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Trade vulnerabilities or money with another user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to trade with')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const targetUser = interaction.options.getUser('user');

            if (targetUser.bot) {
                return interaction.editReply({content: 'You cannot trade with bots!', flags: 64});
            }

            if (targetUser.id === interaction.user.id) {
                return interaction.editReply({content: 'You cannot trade with yourself!', flags: 64});
            }

            const givingUser = await User.findOne({discord_id: interaction.user.id});
            const receivingUser = await User.findOne({discord_id: targetUser.id});

            if (!givingUser || !receivingUser) {
                return interaction.editReply({content: 'One or both users not found in database.', flags: 64});
            }

            // Step 1: Select what you're offering
            const offerType = await selectOfferType(interaction, 'What do you want to offer?');
            if (!offerType) return;

            let givingValue;
            if (offerType === 'vulnerability') {
                givingValue = await selectVulnerability(interaction, givingUser._id);
                if (!givingValue) return;
            } else if (offerType === 'money') {
                givingValue = await enterAmount(interaction, givingUser.money_earned, 'How much money do you want to offer?');
                if (!givingValue) return;
            }

            // Step 2: Select what you want in return
            const requestType = await selectOfferType(interaction, 'What do you want in return?');
            if (!requestType) return;

            let receivingValue;
            if (requestType === 'vulnerability') {
                receivingValue = await selectVulnerability(interaction, receivingUser._id);
                if (!receivingValue) return;
            } else if (requestType === 'money') {
                receivingValue = await enterAmount(interaction, receivingUser.money_earned, 'How much money do you want?');
                if (!receivingValue) return;
            }

            // Step 3: Confirm and create trade
            const confirmed = await confirmTrade(interaction, {
                givingType: offerType,
                givingValue,
                requestType,
                receivingValue,
                targetUser
            });

            if (!confirmed) return;

            // Create trade offer
            const trade = await Trade.create({
                giving_user_id: givingUser._id,
                receiving_user_id: receivingUser._id,
                gu_item_type: offerType,
                ru_item_type: requestType,
                gu_value: givingValue,
                ru_value: receivingValue,
                status: 'pending',
                created_at: new Date(),
                expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
            });

            await interaction.followUp({
                content: `Trade offer sent to ${targetUser.username}!`,
                flags: 64
            });

            // Send server channel notification to target user
            try {
                const givingVulnDoc = offerType === 'vulnerability'
                    ? await Vulnerability.findById(givingValue)
                    : null;

                const receivingVulnDoc = requestType === 'vulnerability'
                    ? await Vulnerability.findById(receivingValue)
                    : null;

                // Post to server channel - only visible to target user via mention
                const {getAnnouncementChannel} = require('../utils/announcementUtils');
                const channel = await getAnnouncementChannel(interaction.client, interaction.guild, 'trades');
                
                const tradeMessage = {
                    content: `${targetUser} **Trade Offer from ${interaction.user.username}**\n\n${formatTradeOffer(
                        offerType,
                        givingValue,
                        requestType,
                        receivingValue,
                        givingVulnDoc,
                        receivingVulnDoc
                    )}`,
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`trade_accept_${trade._id}`)
                                .setLabel('Accept Trade')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(`trade_reject_${trade._id}`)
                                .setLabel('Reject Trade')
                                .setStyle(ButtonStyle.Danger)
                        )
                    ]
                };

                if (channel) {
                    await channel.send(tradeMessage);
                }

                // also notify recipient in their dashboard channel
                try {
                    const { notifyUser } = require('../utils/logUtils');
                    await notifyUser(interaction.client, receivingUser._id, tradeMessage);
                } catch (e) {
                    console.error('Dashboard trade notify failed:', e);
                }
            } catch (err) {
                console.error('Could not send trade notification to target user:', err);
                await interaction.followUp({
                    content: 'Trade created! The other user will be notified in the server.',
                    flags: 64
                });
            }

        } catch (err) {
            console.error(err);
            await interaction.followUp({
                content: 'An error occurred while creating the trade.',
                flags: 64
            });
        }
    },
};

async function selectOfferType(interaction, promptText) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_offer_type')
        .setPlaceholder('Select what to trade')
        .addOptions([
            {label: 'Vulnerability', value: 'vulnerability', description: 'Trade a vulnerability'},
            {label: 'Money', value: 'money', description: 'Trade money'}
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trade_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: promptText,
        components: [row, buttons],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, ['select_offer_type', 'trade_cancel'], 120000);
    if (!response || response.customId === 'cancel') {
        await interaction.editReply({content: 'Trade cancelled.', components: []});
        return null;
    }

    await response.update({content: `Selected: ${response.values[0]}`, components: []});
    return response.values[0];
}

async function selectVulnerability(interaction, userId) {
    const vulnerabilities = await Vulnerability.find({
        'visibility.allowedUsers': userId,
        isResolved: false
    });

    if (!vulnerabilities.length) {
        await interaction.followUp({
            content: 'You have no vulnerabilities available to trade.',
            flags: 64
        });
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_vulnerability')
        .setPlaceholder('Select a vulnerability')
        .addOptions(
            vulnerabilities.slice(0, 25).map(v => ({
                label: v.name || v.volun_type || 'Unknown',
                description: `${v.severity} - ${v.description?.slice(0, 50) || 'No description'}`,
                value: v._id.toString()
            }))
        );

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const message = await interaction.editReply({
        content: 'Select a vulnerability to trade:',
        components: [row],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_vulnerability', 120000);
    if (!response) return null;

    await response.update({content: 'Vulnerability selected.', components: []});
    return response.values[0];
}

async function enterAmount(interaction, maxAmount, promptText) {
    await interaction.editReply({
        content: `${promptText}\n**Your available balance:** $${maxAmount}\n\nPlease type the amount in chat:`,
        components: []
    });

    const filter = (msg) => msg.author.id === interaction.user.id;
    const collected = await interaction.channel.awaitMessages({filter, max: 1, time: 120000});

    if (!collected.size) {
        await interaction.followUp({content: 'Trade timed out.', flags: 64});
        return null;
    }

    const amount = parseFloat(collected.first().content);
    if (isNaN(amount) || amount <= 0) {
        await interaction.followUp({content: 'Invalid amount.', flags: 64});
        return null;
    }

    if (amount > maxAmount) {
        await interaction.followUp({content: 'You do not have enough money!', flags: 64});
        return null;
    }

    await collected.first().delete().catch(() => {
    });
    return amount;
}

async function confirmTrade(interaction, tradeData) {
    const {givingType, givingValue, requestType, receivingValue, targetUser} = tradeData;

    const offerText = formatTradeOffer(givingType, givingValue, requestType, receivingValue);

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trade_confirm')
            .setLabel('Confirm Trade')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('trade_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content: `**Trade Summary with ${targetUser.username}**\n\n${offerText}\n\nConfirm this trade?`,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.Button, ['trade_confirm', 'trade_cancel'], 120000);
    if (!response || response.customId === 'trade_cancel') {
        await interaction.editReply({content: 'Trade cancelled.', components: []});
        return false;
    }

    await response.update({content: 'Creating trade offer...', components: []});
    return true;
}

function formatTradeOffer(givingType, givingValue, requestType, receivingValue, givingVuln, receivingVuln) {
    let offerStr = '**You offer:** ';

    if (givingType === 'money') {
        offerStr += `$${givingValue}`;
    } else {
        offerStr += `${givingVuln.name} (\`${givingVuln.vuln_identifier}\`)`;
    }

    offerStr += '\n**For:** ';

    if (requestType === 'money') {
        offerStr += `$${receivingValue}`;
    } else {
        offerStr += `${receivingVuln.name} (\`${receivingVuln.vuln_identifier}\`)`;
    }

    return offerStr;
}


async function waitForComponent(message, userId, componentType, customIds, time) {
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