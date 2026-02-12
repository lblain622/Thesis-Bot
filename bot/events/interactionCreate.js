const CompanyOffer = require('../../models/CompanyOffers');
const User = require('../../models/Users');
const Report = require('../../models/Reports');
const Trade = require('../../models/Trades');
const Vulnerability = require('../../models/Vulnerabilities');
const {announceVulnerabilityPatched, announceExploitSummary} = require('../events/announcePatches');
const {handleExploitCleanup} = require('../utils/exploitUtils');
const cache = require('../utils/cache');

module.exports = {
    name: 'interactionCreate',
    async execute(interaction) {
        if (!interaction.isButton()) return;

        const [prefix, action, id] = interaction.customId.split('_');

        try {
            // ============= TRADE SYSTEM =============
            if (prefix === 'trade') {
                await handleTrade(interaction, action, id);
            }

            // ============= STANDARD OFFERS =============
            if (prefix === 'offer') {
                const offer = await CompanyOffer.findById(id);
                const report = await Report.findById(offer?.report_id);
                const company = await (require('../../models/Company').findById(report?.company_id));
                const platform = await (require('../../models/Platform').findById(company?.platform_id));

                if (platform?.name?.includes('Ultimatum')) {
                    await handleUltimatumGame(interaction, action, id);
                } else {
                    await handleStandardOffer(interaction, action, id);
                }
            }

            // ============= DICTATOR OFFERS =============
            if (prefix === 'dictator') {
                await handleDictatorOffer(interaction, action, id);
            }

        } catch (err) {
            console.error('Interaction Error:', err);
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({content: 'An error occurred.', ephemeral: true});
            } else {
                await interaction.followUp({content: 'An error occurred.', ephemeral: true});
            }
        }
    },
};

async function handleUltimatumGame(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({content: 'Offer not found.', ephemeral: true});

    const report = await Report.findById(offer.report_id);
    const user = await User.findById(report.user_id);
    if (!user) return interaction.reply({content: 'User not found.', ephemeral: true});

    if (action === 'accept') {
        // Calculate total bonus
        const baseAmount = offer.offered_amount;
        const reputationBonus = (report.reputation_bonus || 0) / 100;
        const preferredBonus = (report.preferred_vuln_bonus || 0) / 100;
        const totalMultiplier = 1 + reputationBonus + preferredBonus;
        const finalAmount = Math.floor(baseAmount * totalMultiplier);

        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'accepted'}});
        await User.updateOne(
            {_id: user._id},
            {
                $inc: {
                    money_earned: finalAmount,
                    balance: finalAmount,
                    money_from_reports: finalAmount,
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
        const vulnerability = await Vulnerability.findById(report.vulnerability_id);
        if (vulnerability) {
            vulnerability.isResolved = true;
            vulnerability.is_resolved_date = new Date();

            await vulnerability.save();

            if (interaction.guild) {
                // Pass the server ID (guild ID) to the announcement function
                await announceVulnerabilityPatched(
                    interaction.client,
                    vulnerability,
                    offer,
                    interaction.guild.id
                );

                // Handle exploit cleanup and announcement
                const exploitSummary = await handleExploitCleanup(vulnerability._id);
                if (exploitSummary.caughtCount > 0) {
                    await announceExploitSummary(
                        interaction.client,
                        interaction.guild.id,
                        vulnerability.vuln_identifier,
                        exploitSummary
                    );
                }
            }
        }
    }

    if (action === 'reject') {
        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'rejected'}});
        await updateCompanyReputation(user._id, report.company_id, -2);

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: `You rejected the offer of $${offer.offered_amount}.`,
                ephemeral: true
            });
        } else {
            await interaction.update({content: `You rejected the offer of $${offer.offered_amount}.`, components: []});
        }
    }

    if (action === 'counter') {
        const company = await (require('../../models/Company').findById(report.company_id));
        await interaction.reply({
            content: `Please type your counteroffer amount (USD) for **${company?.name || 'the company'}**:`,
            ephemeral: true
        });

        const filter = (msg) => msg.author.id === interaction.user.id;
        const collected = await interaction.channel.awaitMessages({filter, max: 1, time: 120000});

        if (!collected.size) return interaction.followUp({content: 'Counteroffer timed out.', ephemeral: true});

        const amount = parseFloat(collected.first().content);
        if (isNaN(amount) || amount <= 0)
            return interaction.followUp({content: 'Invalid amount.', ephemeral: true});

        // Logic for negotiation: 
        // 1. If amount <= offered_amount: Accept (User asked for less or same)
        // 2. If amount <= original_amount: High chance of acceptance (original amount is what company first thought of)
        // 3. If amount > original_amount: Decreasing chance of acceptance based on how much higher

        let accepted = false;
        let finalOfferAmount = amount;
        let reason = "";

        const currentOffered = offer.offered_amount;
        const originalBase = offer.original_amount;

        if (amount <= currentOffered) {
            accepted = true;
            reason = "The company is happy to with what you ofered offered!";
        } else {
            const ratio = amount / originalBase;
            // 1.0 ratio -> 90% chance
            // 1.2 ratio -> 50% chance
            // 1.5 ratio -> 10% chance
            // 2.0 ratio -> 0% chance
            let chance = 0;
            if (ratio <= 1.0) chance = 0.95;
            else if (ratio <= 2.0) chance = 0.95 * Math.pow(1 - (ratio - 1), 2);

            if (Math.random() < chance) {
                accepted = true;
                reason = "The company accepted your counteroffer!";
            } else if (Math.random() < 0.3 && ratio < 1.5) {
                // Counter-counter offer
                finalOfferAmount = Math.floor((amount + currentOffered) / 2);
                accepted = true;
                reason = `The company rejected $${amount} but countered with a final offer of $${finalOfferAmount}. (Automatically accepted as negotiation)`;
            }
        }

        if (accepted) {
            await CompanyOffer.updateOne(
                {_id: offer._id},
                {
                    $set: {
                        status: 'accepted',
                        counter_offer: amount,
                        offered_amount: finalOfferAmount,
                        resolved_at: new Date()
                    }
                }
            );

            // Apply rewards (Money + Rep + Items)
            const repBonus = parseInt(offer.reputation_offered || offer.repuatation_offered || 0);
            await User.updateOne(
                {_id: user._id},
                {
                    $inc: {
                        money_earned: finalOfferAmount,
                        balance: finalOfferAmount,
                        money_from_reports: finalOfferAmount,
                        repuation_earned: repBonus,
                    },
                }
            );

            // Grant items
            if (Array.isArray(offer.items) && offer.items.length) {
                const Items = require('../../models/Items');
                const userDoc = await User.findById(user._id).lean();
                const inv = Array.isArray(userDoc.inventory) ? userDoc.inventory : [];
                for (const it of offer.items) {
                    try {
                        const itemDoc = await Items.findById(it.item_id).lean();
                        if (!itemDoc) continue;
                        const companyIdStr = it.company_id ? String(it.company_id) : '';
                        if (itemDoc.stackable) {
                            const idx = inv.findIndex(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                            if (idx >= 0) {
                                await User.updateOne({_id: user._id}, {$inc: {[`inventory.${idx}.qty`]: it.qty || 1}});
                            } else {
                                await User.updateOne({_id: user._id}, {
                                    $push: {
                                        inventory: {
                                            item_id: it.item_id,
                                            company_id: it.company_id || null,
                                            qty: it.qty || 1
                                        }
                                    }
                                });
                            }
                        } else {
                            let exists = false;
                            if (itemDoc.companyScoped) {
                                exists = inv.some(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                            } else {
                                exists = inv.some(e => String(e.item_id) === String(it.item_id));
                            }
                            if (!exists) {
                                await User.updateOne({_id: user._id}, {
                                    $push: {
                                        inventory: {
                                            item_id: it.item_id,
                                            company_id: it.company_id || null,
                                            qty: 1
                                        }
                                    }
                                });
                            }
                        }
                    } catch (_) {
                    }
                }
            }

            await updateCompanyReputation(user._id, report.company_id, 3);

            const vulnerability = await Vulnerability.findById(report.vulnerability_id);
            if (vulnerability) {
                vulnerability.isResolved = true;
                vulnerability.is_resolved_date = new Date();
                await vulnerability.save();

                if (interaction.guild) {
                    // Pass the server ID (guild ID) to the announcement function
                    await announceVulnerabilityPatched(
                        interaction.client,
                        vulnerability,
                        offer,
                        interaction.guild.id
                    );

                    // Handle exploit cleanup and announcement
                    const exploitSummary = await handleExploitCleanup(vulnerability._id);
                    if (exploitSummary.caughtCount > 0) {
                        await announceExploitSummary(
                            interaction.client,
                            interaction.guild.id,
                            vulnerability.vuln_identifier,
                            exploitSummary
                        );
                    }
                }
            }

            const msg = `${reason}\n` +
                `**Final Payout:** $${finalOfferAmount}\n` +
                `**Reputation:** +${repBonus}` +
                (offer.items?.length ? `\n**Items Received:** ${offer.items.length} item(s)` : '');

            return interaction.followUp({content: msg, ephemeral: true});
        } else {
            await CompanyOffer.updateOne(
                {_id: offer._id},
                {$set: {status: 'rejected', counter_offer: amount, resolved_at: new Date()}}
            );
            await updateCompanyReputation(user._id, report.company_id, -1);
            return interaction.followUp({
                content: `The company rejected your counteroffer of $${amount} and has withdrawn the original offer.`,
                ephemeral: true,
            });
        }
    }
}

async function handleStandardOffer(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({content: 'Offer not found.', ephemeral: true});
    if (offer.status !== 'pending') return interaction.reply({
        content: 'This offer is no longer available.',
        ephemeral: true
    });

    const report = await Report.findById(offer.report_id);
    if (!report) return interaction.reply({content: 'Related report not found.', ephemeral: true});
    if (String(interaction.user.id) !== String((await User.findById(report.user_id).lean())?.discord_id)) {
        // Fallback: also allow directly by comparing stored discord ids
        const usr = await User.findById(report.user_id).lean();
        if (!usr || usr.discord_id !== interaction.user.id) {
            return interaction.reply({content: 'This offer does not belong to you.', ephemeral: true});
        }
    }

    if (action === 'accept') {
        // Credit money and reputation, grant items
        const u = await User.findById(report.user_id);
        const money = Number(offer.offered_amount || 0);
        const repBonus = Number(offer.repuatation_offered || offer.reputation_offered || 0);
        if (money > 0) {
            await User.updateOne({_id: u._id}, {$inc: {money_earned: money, repuation_earned: repBonus}});
        } else if (repBonus) {
            await User.updateOne({_id: u._id}, {$inc: {repuation_earned: repBonus}});
        }

        // Grant attached items if any
        if (Array.isArray(offer.items) && offer.items.length) {
            const Items = require('../../models/Items');
            const userDoc = await User.findById(u._id).lean();
            const inv = Array.isArray(userDoc.inventory) ? userDoc.inventory : [];
            for (const it of offer.items) {
                try {
                    const itemDoc = await Items.findById(it.item_id).lean();
                    if (!itemDoc) continue;
                    const companyIdStr = it.company_id ? String(it.company_id) : '';
                    if (itemDoc.stackable) {
                        const idx = inv.findIndex(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                        if (idx >= 0) {
                            await User.updateOne({_id: u._id}, {$inc: {[`inventory.${idx}.qty`]: it.qty || 1}});
                        } else {
                            await User.updateOne({_id: u._id}, {
                                $push: {
                                    inventory: {
                                        item_id: it.item_id,
                                        company_id: it.company_id || null,
                                        qty: it.qty || 1
                                    }
                                }
                            });
                        }
                    } else {
                        // Non-stackable: prevent duplicates
                        let exists = false;
                        if (itemDoc.companyScoped) {
                            exists = inv.some(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                        } else {
                            exists = inv.some(e => String(e.item_id) === String(it.item_id));
                        }
                        if (!exists) {
                            await User.updateOne({_id: u._id}, {
                                $push: {
                                    inventory: {
                                        item_id: it.item_id,
                                        company_id: it.company_id || null,
                                        qty: 1
                                    }
                                }
                            });
                        }
                    }
                } catch (_) {
                }
            }
        }

        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'accepted', resloved_at: new Date()}});
        const msg = `You accepted the offer and received $${money}` + (offer.items?.length ? ` and ${offer.items.length} item(s).` : '.');

        const vulnerability = await Vulnerability.findById(report.vulnerability_id);
        if (vulnerability) {
            vulnerability.isResolved = true;
            vulnerability.is_resolved_date = new Date();
            await vulnerability.save();

            if (interaction.guild) {
                await announceVulnerabilityPatched(
                    interaction.client,
                    vulnerability,
                    offer,
                    interaction.guild.id
                );

                // Handle exploit cleanup and announcement
                const exploitSummary = await handleExploitCleanup(vulnerability._id);
                if (exploitSummary.caughtCount > 0) {
                    await announceExploitSummary(
                        interaction.client,
                        interaction.guild.id,
                        vulnerability.vuln_identifier,
                        exploitSummary
                    );
                }
            }
        }

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({content: msg, ephemeral: true});
        } else {
            await interaction.update({content: msg, components: []});
        }
        return;
    }

    if (action === 'reject') {
        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'rejected', resloved_at: new Date()}});
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: `You rejected the offer of $${offer.offered_amount}.`,
                ephemeral: true
            });
        } else {
            await interaction.update({content: `You rejected the offer of $${offer.offered_amount}.`, components: []});
        }

    }
}

async function handleDictatorOffer(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({content: 'Offer not found.', ephemeral: true});
    if (offer.status !== 'pending') return interaction.reply({
        content: 'This offer is no longer available.',
        ephemeral: true
    });
    const report = await Report.findById(offer.report_id);
    if (!report) return interaction.reply({content: 'Related report not found.', ephemeral: true});
    const user = await User.findById(report.user_id).lean();
    if (!user || user.discord_id !== interaction.user.id) return interaction.reply({
        content: 'This offer does not belong to you.',
        ephemeral: true
    });

    let choice = null;
    if (action === 'option1') choice = 'option1';
    if (action === 'option2') choice = 'option2';
    if (!choice) return interaction.reply({content: 'Invalid selection.', ephemeral: true});

    const opt = offer.dictator_options?.[choice];
    if (!opt) return interaction.reply({content: 'Offer options unavailable.', ephemeral: true});

    const money = Number(opt.money || 0);
    const rep = Number(opt.rep || 0);
    await User.updateOne({_id: user._id}, {
        $inc: {
            money_earned: money,
            balance: money,
            money_from_reports: money,
            repuation_earned: rep
        }
    });

    // Grant attached items if any
    if (Array.isArray(offer.items) && offer.items.length) {
        const Items = require('../../models/Items');
        const userDoc = await User.findById(user._id).lean();
        const inv = Array.isArray(userDoc.inventory) ? userDoc.inventory : [];
        for (const it of offer.items) {
            try {
                const itemDoc = await Items.findById(it.item_id).lean();
                if (!itemDoc) continue;
                const companyIdStr = it.company_id ? String(it.company_id) : '';
                if (itemDoc.stackable) {
                    const idx = inv.findIndex(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                    if (idx >= 0) {
                        await User.updateOne({_id: user._id}, {$inc: {[`inventory.${idx}.qty`]: it.qty || 1}});
                    } else {
                        await User.updateOne({_id: user._id}, {
                            $push: {
                                inventory: {
                                    item_id: it.item_id,
                                    company_id: it.company_id || null,
                                    qty: it.qty || 1
                                }
                            }
                        });
                    }
                } else {
                    let exists = false;
                    if (itemDoc.companyScoped) {
                        exists = inv.some(e => String(e.item_id) === String(it.item_id) && String(e.company_id || '') === companyIdStr);
                    } else {
                        exists = inv.some(e => String(e.item_id) === String(it.item_id));
                    }
                    if (!exists) {
                        await User.updateOne({_id: user._id}, {
                            $push: {
                                inventory: {
                                    item_id: it.item_id,
                                    company_id: it.company_id || null,
                                    qty: 1
                                }
                            }
                        });
                    }
                }
            } catch (_) {
            }
        }
    }

    await CompanyOffer.updateOne({_id: offer._id}, {
        $set: {
            status: 'accepted',
            dictator_choice: choice,
            resloved_at: new Date()
        }
    });

    const vulnerability = await Vulnerability.findById(report.vulnerability_id);
    if (vulnerability) {
        vulnerability.isResolved = true;
        vulnerability.is_resolved_date = new Date();
        await vulnerability.save();

        if (interaction.guild) {
            // Pass the server ID (guild ID) to the announcement function
            await announceVulnerabilityPatched(
                interaction.client,
                vulnerability,
                offer,
                interaction.guild.id
            );

            // Handle exploit cleanup and announcement
            const exploitSummary = await handleExploitCleanup(vulnerability._id);
            if (exploitSummary.caughtCount > 0) {
                await announceExploitSummary(
                    interaction.client,
                    interaction.guild.id,
                    vulnerability.vuln_identifier,
                    exploitSummary
                );
            }
        }
    }

    const msg = `You chose ${choice === 'option1' ? 'Option 1' : 'Option 2'} and received $${money}${rep ? ` and +${rep} reputation` : ''}` + (offer.items?.length ? ` and ${offer.items.length} item(s).` : '.');
    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({content: msg, ephemeral: true});
    } else {
        await interaction.update({content: msg, components: []});
    }
}

async function handleDictatorGame(interaction, action, offerId) {
    const offer = await CompanyOffer.findById(offerId);
    if (!offer) return interaction.reply({content: 'Offer not found.', ephemeral: true});

    const report = await Report.findById(offer.report_id);
    const user = await User.findById(report.user_id);
    if (!user) return interaction.reply({content: 'User not found.', ephemeral: true});

    const options = offer.dictator_options;
    if (!options) return interaction.reply({content: 'No dictator options found.', ephemeral: true});

    let selected;
    if (action === 'option1') selected = options.option1;
    if (action === 'option2') selected = options.option2;
    if (!selected) return interaction.reply({content: 'Invalid choice.', ephemeral: true});

    // Apply bonuses
    const reputationBonus = (report.reputation_bonus || 0) / 100;
    const preferredBonus = (report.preferred_vuln_bonus || 0) / 100;
    const totalMultiplier = 1 + reputationBonus + preferredBonus;
    const finalMoney = Math.floor(selected.money * totalMultiplier);

    await CompanyOffer.updateOne(
        {_id: offer._id},
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
        {_id: user._id},
        {
            $inc: {
                money_earned: finalMoney,
                balance: finalMoney,
                money_from_reports: finalMoney,
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
    const vulnerability = await Vulnerability.findById(report.vulnerability_id);
    if (vulnerability && interaction.guild) {
        // Pass the server ID (guild ID) to the announcement function
        await announceVulnerabilityPatched(
            interaction.client,
            vulnerability,
            offer,
            interaction.guild.id
        );
    }
}

async function handleTrade(interaction, action, tradeId) {
    // Fetch trade without populate for better performance
    const trade = await Trade.findById(tradeId).lean();

    if (!trade) {
        return interaction.reply({content: 'Trade not found.', ephemeral: true});
    }

    // Fetch users in parallel
    const [givingUser, receivingUser, currentUser] = await Promise.all([
        User.findById(trade.giving_user_id).lean(),
        User.findById(trade.receiving_user_id).lean(),
        User.findOne({discord_id: interaction.user.id}).lean()
    ]);

    const user = currentUser;
    if (!user) {
        return interaction.reply({content: 'User not found.', ephemeral: true});
    }

    const isGiver = trade.giving_user_id.toString() === user._id.toString();
    const isReceiver = trade.receiving_user_id.toString() === user._id.toString();

    if (!isGiver && !isReceiver) {
        return interaction.reply({content: 'You are not part of this trade.', ephemeral: true});
    }

    // --- HANDLE REJECTIONS --- //
    if (action === 'reject') {
        await Trade.updateOne(
            {_id: tradeId},
            {status: 'rejected', resolved_at: new Date()}
        );

        await interaction.update({
            content: '❌ Trade rejected.',
            components: []
        });

        // Notify other user
        const other = isGiver ? receivingUser : givingUser;
        try {
            const discordOther = await interaction.client.users.fetch(other.discord_id);
            await discordOther.send(` Your trade was rejected by ${interaction.user.username}.`);
        } catch {
        }

        return;
    }

    // --- HANDLE ACCEPTANCE --- //

    // Receiver accepts first
    if (isReceiver && action === 'accept' && trade.status === 'pending') {
        await Trade.updateOne({_id: tradeId}, {status: 'receiver_accepted'});

        await interaction.update({
            content: 'You accepted the trade. Waiting for the other user…',
            components: []
        });

        // Notify giver for final confirmation
        const giverDiscord = await interaction.client.users.fetch(givingUser.discord_id);
        await giverDiscord.send({
            content: `**${interaction.user.username} accepted your trade!**\n\nPlease confirm the trade:`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        // Use a single token for the action to keep split('_') to 3 parts
                        .setCustomId(`trade_acceptfinal_${trade._id}`)
                        .setLabel('Accept Trade')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`trade_reject_${trade._id}`)
                        .setLabel('Reject Trade')
                        .setStyle(ButtonStyle.Danger)
                )
            ]
        });

        return;
    }

    // Giver accepts second → finalize trade
    if (isGiver && action === 'acceptfinal' && trade.status === 'receiver_accepted') {
        try {
            // Run exchange
            await executeTrade(trade);

            await Trade.updateOne(
                {_id: tradeId},
                {status: 'completed', resolved_at: new Date()}
            );

            await interaction.update({
                content: ' Trade completed successfully!',
                components: []
            });

            // Notify receiver
            const recvDiscord = await interaction.client.users.fetch(receivingUser.discord_id);
            await recvDiscord.send(`🎉 The trade with ${interaction.user.username} is complete!`);

        } catch (err) {
            console.error('Final trade error:', err);

            await interaction.update({
                content: ' Trade failed (insufficient funds or missing items).',
                components: []
            });
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
            {_id: userId, 'reputation_breakdown.company_id': companyId},
            {$inc: {'reputation_breakdown.$.trust_score': change}}
        );
    } else {
        await User.updateOne(
            {_id: userId},
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