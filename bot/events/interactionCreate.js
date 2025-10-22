const CompanyOffer = require('../../models/CompanyOffers');
const User = require('../../models/Users');
const Report = require('../../models/Reports');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const [prefix, action, offerId] = interaction.customId.split('_');
        if (prefix !== 'offer') return;

        const offer = await CompanyOffer.findById(offerId);
        if (!offer) return interaction.reply({ content: 'Offer not found.', ephemeral: true });

        const report = await Report.findById(offer.report_id);
        const userId = await User.findById(report.user_id);

        try {
            if (action === 'accept') {
                await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'accepted' } });
                await User.updateOne(
                    { _id: userId },
                    { $inc: { money_earned: offer.offered_amount, reputation_earned: parseInt(offer.reputation_offered || 0) } }
                );

                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: `You accepted the offer of $${offer.offered_amount}.`, ephemeral: true });
                } else {
                    await interaction.update({ content: `You accepted the offer of $${offer.offered_amount}.`, components: [] });
                }
            }

            if (action === 'reject') {
                await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'rejected' } });

                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({ content: `You rejected the offer of $${offer.offered_amount}.`, ephemeral: true });
                } else {
                    await interaction.update({ content: `You rejected the offer of $${offer.offered_amount}.`, components: [] });
                }
            }

            if (action === 'counter') {
                await interaction.reply({ content: 'Please type your counteroffer amount (USD):', ephemeral: true });

                const filter = msg => msg.author.id === interaction.user.id;
                const collected = await interaction.channel.awaitMessages({ filter, max: 1, time: 120000 });

                if (!collected.size) return interaction.followUp({ content: 'Counteroffer timed out.', ephemeral: true });

                const amount = parseFloat(collected.first().content);
                if (isNaN(amount) || amount <= 0) return interaction.followUp({ content: 'Invalid amount.', ephemeral: true });

                offer.counter_offer = amount;

                if (amount <= offer.original_amount) {
                    await CompanyOffer.updateOne(
                        { _id: offer._id },
                        { $set: { status: 'accepted', counter_offer: amount, offered_amount: amount } }
                    );

                    await User.updateOne(
                        { _id: userId },
                        { $inc: { money_earned: amount, reputation_earned: parseInt(offer.reputation_offered || 0) } }
                    );

                    return interaction.followUp({ content: `Your counteroffer of $${amount} has been accepted.`, ephemeral: true });
                } else {
                    await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'rejected', counter_offer: amount } });

                    return interaction.followUp({ content: `Your counteroffer of $${amount} exceeds the original offer and was rejected.`, ephemeral: true });
                }
            }
        } catch (err) {
            console.error(err);
            if (!interaction.replied) {
                await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'Something went wrong.', ephemeral: true });
            }
        }
    },
};
