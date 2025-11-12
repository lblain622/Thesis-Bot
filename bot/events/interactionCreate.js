const CompanyOffer = require('../../models/CompanyOffers');
const User = require('../../models/Users');
const Report = require('../../models/Reports');
const Trade = require('../../models/Trades');
const Vulnerability = require('../../models/Volunerabilies');
const { announceVulnerabilityPatched } = require('../events/announcePatches');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const [prefix, action, id] = interaction.customId.split('_');

        try {
            // ============= ULTIMATUM GAME =============
            if (prefix === 'offer') {
                await handleUltimatumGame(interaction, action, id);
            }

            // ============= DICTATOR GAME =============
            if (prefix === 'dictator') {
                await handleDictatorGame(interaction, action, id);
            }

            // ============= TRADE SYSTEM =============
            if (prefix === 'trade') {
                await handleTrade(interaction, action, id);
            }

        } catch (err) {
            console.error('Interaction Error:', err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'An error occurred.', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'An error occurred.', ephemeral: true });
            }
        }
    },
};

async function handleUltimatumGame(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({ content: 'Offer not found.', ephemeral: true });

    const report = await Report.findById(offer.report_id);
    const user = await User.findById(report.user_id);
    if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

    if (action === 'accept') {
        // Calculate total bonus
        const baseAmount = offer.offered_amount;
        const reputationBonus = (report.reputation_bonus || 0) / 100;
        const preferredBonus = (report.preferred_vuln_bonus || 0) / 100;
        const totalMultiplier = 1 + reputationBonus + preferredBonus;
        const finalAmount = Math.floor(baseAmount * totalMultiplier);

        await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'accepted' } });
        await User.updateOne(
            { _id: user._id },
            {
                $inc: {
                    money_earned: finalAmount,
                   repuation_earned: parseInt(offer.reputation_offered || 0),
                },
            }
        );

        // Update company reputation
        await updateCompanyReputation(user._id, report.company_id, 5);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: `You accepted the offer!\n` +
                    `**Base:** $${baseAmount}\n` +
                    `**With Bonuses:** $${finalAmount}\n` +
                    `**Reputation:** +${offer.reputation_offered || 0}`,
                ephemeral: true
            });
        } else {
            await interaction.update({
                content: `You accepted the offer!\n` +
                    `**Base:** $${baseAmount}\n` +
                    `**With Bonuses:** $${finalAmount}\n` +
                    `**Reputation:** +${offer.reputation_offered || 0}`,
                components: []
            });
        }
    }

    if (action === 'reject') {
        await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'rejected' } });
        await updateCompanyReputation(user._id, report.company_id, -2);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: `You rejected the offer of $${offer.offered_amount}.`, ephemeral: true });
        } else {
            await interaction.update({ content: `You rejected the offer of $${offer.offered_amount}.`, components: [] });
        }
    }

    if (action === 'counter') {
        await interaction.reply({ content: 'Please type your counteroffer amount (USD):', ephemeral: true });

        const filter = (msg) => msg.author.id === interaction.user.id;
        const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000 });

        if (!collected.size) return interaction.followUp({ content: 'Counteroffer timed out.', ephemeral: true });

        const amount = parseFloat(collected.first().content);
        if (isNaN(amount) || amount <= 0)
            return interaction.followUp({ content: 'Invalid amount.', ephemeral: true });

        if (amount <= offer.original_amount) {
            await CompanyOffer.updateOne(
                { _id: offer._id },
                { $set: { status: 'accepted', counter_offer: amount, offered_amount: amount } }
            );
            await User.updateOne(
                { _id: user._id },
                {
                    $inc: {
                        money_earned: amount,
                        repuation_earned: parseInt(offer.reputation_offered || 0),
                    },
                }
            );
            await updateCompanyReputation(user._id, report.company_id, 3);
            return interaction.followUp({ content: `Your counteroffer of $${amount} was accepted.`, ephemeral: true });
        } else {
            await CompanyOffer.updateOne(
                { _id: offer._id },
                { $set: { status: 'rejected', counter_offer: amount } }
            );
            await updateCompanyReputation(user._id, report.company_id, -1);
            return interaction.followUp({
                content: `Your counteroffer of $${amount} exceeded the original offer and was rejected.`,
                ephemeral: true,
            });
        }
    }
}

async function handleDictatorGame(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({ content: 'Offer not found.', ephemeral: true });

    const report = await Report.findById(offer.report_id);
    const user = await User.findById(report.user_id);
    if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

    const options = offer.dictator_options;
    if (!options) return interaction.reply({ content: 'No dictator options found.', ephemeral: true });

    let selected;
    if (action === 'option1') selected = options.option1;
    if (action === 'option2') selected = options.option2;
    if (!selected) return interaction.reply({ content: 'Invalid choice.', ephemeral: true });

    // Apply bonuses
    const reputationBonus = (report.reputation_bonus || 0) / 100;
    const preferredBonus = (report.preferred_vuln_bonus || 0) / 100;
    const totalMultiplier = 1 + reputationBonus + preferredBonus;
    const finalMoney = Math.floor(selected.money * totalMultiplier);

    await CompanyOffer.updateOne(
        { _id: offer._id },
        {
            $set: {
                status: 'accepted',
                dictator_choice: action,
                offered_amount: finalMoney,
                reputation_offered: selected.rep,
            },
        }
    );

    await User.updateOne(
        { _id: user._id },
        {
            $inc: {
                money_earned: finalMoney,
                repuation_earned: selected.rep,
            },
        }
    );

    await updateCompanyReputation(user._id, report.company_id, 3);

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
            content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**\n` +
                `**Money:** $${finalMoney} (base: $${selected.money})\n` +
                `**Reputation:** ${selected.rep}`,
            ephemeral: true,
        });
    } else {
        await interaction.update({
            content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**\n` +
                `**Money:** $${finalMoney} (base: $${selected.money})\n` +
                `**Reputation:** ${selected.rep}`,
            components: [],
        });
    }
}

async function handleTrade(interaction, action, tradeId) {
    const trade = await Trade.findById(tradeId)
        .populate('giving_user_id')
        .populate('receiving_user_id');

    if (!trade) {
        return interaction.reply({ content: 'Trade not found.', ephemeral: true });
    }

    // Verify the user is the receiving user
    const receivingUser = await User.findOne({ discord_id: interaction.user.id });
    if (!receivingUser || receivingUser._id.toString() !== trade.receiving_user_id._id.toString()) {
        return interaction.reply({ content: 'This trade is not for you.', ephemeral: true });
    }

    if (action === 'accept') {
        // Execute the trade
        try {
            // Transfer items from giving user to receiving user
            if (trade.gu_item_type === 'vulnerability') {
                await Vulnerability.updateOne(
                    { _id: trade.gu_value },
                    { $addToSet: { 'visibility.allowedUsers': receivingUser._id } }
                );
            } else if (trade.gu_item_type === 'money') {
                await User.updateOne(
                    { _id: trade.giving_user_id._id },
                    { $inc: { money_earned: -trade.gu_value } }
                );
                await User.updateOne(
                    { _id: receivingUser._id },
                    { $inc: { money_earned: trade.gu_value } }
                );
            }

            // Transfer items from receiving user to giving user
            if (trade.ru_item_type === 'vulnerability') {
                await Vulnerability.updateOne(
                    { _id: trade.ru_value },
                    { $addToSet: { 'visibility.allowedUsers': trade.giving_user_id._id } }
                );
            } else if (trade.ru_item_type === 'money') {
                await User.updateOne(
                    { _id: receivingUser._id },
                    { $inc: { money_earned: -trade.ru_value } }
                );
                await User.updateOne(
                    { _id: trade.giving_user_id._id },
                    { $inc: { money_earned: trade.ru_value } }
                );
            }

            await Trade.updateOne(
                { _id: tradeId },
                { $set: { status: 'accepted', resolved_at: new Date() } }
            );

            await interaction.update({
                content: '✅ Trade accepted successfully!',
                components: []
            });

            // Notify the giving user
            try {
                const givingDiscordUser = await interaction.client.users.fetch(trade.giving_user_id.discord_id);
                await givingDiscordUser.send(`Your trade with ${interaction.user.username} was accepted!`);
            } catch (err) {
                console.error('Could not notify giving user:', err);
            }

        } catch (err) {
            console.error('Trade execution error:', err);
            await interaction.update({
                content: 'Trade failed. Please ensure you have sufficient resources.',
                components: []
            });
        }
    }

    if (action === 'reject') {
        await Trade.updateOne(
            { _id: tradeId },
            { $set: { status: 'rejected', resolved_at: new Date() } }
        );

        await interaction.update({
            content: 'Trade rejected.',
            components: []
        });

        // Notify the giving user
        try {
            const givingDiscordUser = await interaction.client.users.fetch(trade.giving_user_id.discord_id);
            await givingDiscordUser.send(`Your trade with ${interaction.user.username} was rejected.`);
        } catch (err) {
            console.error('Could not notify giving user:', err);
        }
    }
}

async function updateCompanyReputation(userId, companyId, change) {
    const user = await User.findById(userId);

    const existingRep = user.reputation_breakdown?.find(
        r => r.company_id.toString() === companyId.toString()
    );

    if (existingRep) {
        await User.updateOne(
            { _id: userId, 'reputation_breakdown.company_id': companyId },
            { $inc: { 'reputation_breakdown.$.trust_score': change } }
        );
    } else {
        await User.updateOne(
            { _id: userId },
            {
                $push: {
                    reputation_breakdown: {
                        company_id: companyId,
                        trust_score: Math.max(0, change)
                    }
                }
            }
        );
    }
}