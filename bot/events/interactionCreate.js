const CompanyOffer = require('../../models/CompanyOffers');
const User = require('../../models/Users');
const Report = require('../../models/Reports');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const [prefix, action, offerId] = interaction.customId.split('_');

        try {
            // ULTIMATUM GAME
            if (prefix === 'offer') {
                const offer = await CompanyOffer.findById(offerId);
                if (!offer) return interaction.reply({ content: 'Offer not found.', ephemeral: true });

                const report = await Report.findById(offer.report_id);
                const user = await User.findById(report.user_id);
                if (!user) return interaction.reply({ content: 'User not found.', ephemeral: true });

                if (action === 'accept') {
                    await CompanyOffer.updateOne({ _id: offer._id }, { $set: { status: 'accepted' } });
                    await User.updateOne(
                        { _id: user._id },
                        {
                            $inc: {
                                money_earned: offer.offered_amount,
                                reputation_earned: parseInt(offer.reputation_offered || 0),
                                reports_made: 1,
                            },
                        }
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
                                    reputation_earned: parseInt(offer.reputation_offered || 0),
                                    reports_made: 1,
                                },
                            }
                        );
                        return interaction.followUp({ content: `Your counteroffer of $${amount} was accepted.`, ephemeral: true });
                    } else {
                        await CompanyOffer.updateOne(
                            { _id: offer._id },
                            { $set: { status: 'rejected', counter_offer: amount } }
                        );
                        return interaction.followUp({
                            content: `Your counteroffer of $${amount} exceeded the original offer and was rejected.`,
                            ephemeral: true,
                        });
                    }
                }
            }

            // DICTATOR GAME
            if (prefix === 'dictator') {
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

                await CompanyOffer.updateOne(
                    { _id: offer._id },
                    {
                        $set: {
                            status: 'accepted',
                            dictator_choice: action,
                            offered_amount: selected.money,
                            reputation_offered: selected.rep,
                        },
                    }
                );

                await User.updateOne(
                    { _id: user._id },
                    {
                        $inc: {
                            money_earned: selected.money,
                            reputation_earned: selected.rep,
                            reports_made: 1,
                        },
                    }
                );

                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**: $${selected.money} + ${selected.rep} reputation.`,
                        ephemeral: true,
                    });
                } else {
                    await interaction.update({
                        content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**: $${selected.money} + ${selected.rep} reputation.`,
                        components: [],
                    });
                }
            }
        } catch (err) {
            console.error('Interaction Error:', err);
            if (!interaction.replied) {
                await interaction.reply({ content: 'An error occurred.', ephemeral: true });
            } else {
                await interaction.followUp({ content: 'An error occurred.', ephemeral: true });
            }
        }
    },
};
