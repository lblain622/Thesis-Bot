const CompanyOffer = require('../../models/CompanyOffers');
const User = require('../../models/Users');
const Report = require('../../models/Reports');
const Trade = require('../../models/Trades');
const Vulnerability = require('../../models/Vulnerabilities');
const {announceVulnerabilityPatched, announceExploitSummary} = require('../events/announcePatches');
const {handleExploitCleanup, awardReporterBonus} = require('../utils/exploitUtils');
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

    // Spam prevention: check if user already responded
    if (offer.user_responded) {
        return interaction.reply({
            content: '⚠️ You already responded to this offer. Only one response per offer is allowed.',
            ephemeral: true
        });
    }

    const report = await Report.findById(offer.report_id);
    const user = await User.findById(report.user_id);
    if (!user) return interaction.reply({content: 'User not found.', ephemeral: true});

    if (action === 'accept') {
        // Calculate total bonus
        const baseAmount = offer.offered_amount;
        const reputationBonus = (report.reputation_bonus || 0) / 100;
        const preferredBonus = (report.preferred_vuln_bonus || 0) / 100;
        const totalMultiplier = 1 + reputationBonus + preferredBonus;
        const constBonus = Number(process.env.CONSTANT_REPORT_BONUS || 0);
        const finalAmount = Math.floor(baseAmount * totalMultiplier) + constBonus;

        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'accepted', user_responded: true, responded_at: new Date()}});
        await User.updateOne(
            {_id: user._id},
            {
                $inc: {
                    money_earned: finalAmount,
                    balance: finalAmount,
                    money_from_reports: finalAmount,
                    reputation_earned: parseInt(offer.reputation_offered || offer.repuatation_offered || 0),
                },
            }
        );

        // voucher split
        if (offer.voucher_user_id && offer.voucher_amount && offer.voucher_amount > 0) {
            try {
                await User.updateOne({_id: offer.voucher_user_id}, {
                    $inc: {money_earned: offer.voucher_amount, balance: offer.voucher_amount, money_from_vouches: offer.voucher_amount}
                });
                const voucherDoc = await User.findById(offer.voucher_user_id).lean();
                if (voucherDoc) {
                    const { notifyUser } = require('../utils/logUtils');
                    await notifyUser(interaction.client, voucherDoc._id,
                        `💸 You received $${offer.voucher_amount} for vouching on a report!`);
                }
            } catch (e) {
                console.error('Error paying voucher share (ultimatum):', e);
            }
        }
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({
                content: responseMsg,
                ephemeral: true
            });
        } else {
            await interaction.update({
                content: responseMsg,
                components: []
            });
        }
        const vulnerability = await Vulnerability.findById(report.vulnerability_id);
        if (vulnerability) {
            vulnerability.isResolved = true;
            vulnerability.is_resolved_date = new Date();

            await vulnerability.save();

            // Award bonus to reporter if they're not exploiting
            const bonusResult = await awardReporterBonus(report.user_id, vulnerability._id);

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
                
                // Notify reporter about bonus
                if (bonusResult.awarded) {
                    try {
                        const { notifyUser } = require('../utils/logUtils');
                        const bonusMsg = `🎁 **Bonus Reward!** You caught ${bonusResult.exploiterCount} exploiter${bonusResult.exploiterCount > 1 ? 's' : ''} on **${vulnerability.vuln_identifier}**. ` +
                            `You received a bonus of $${bonusResult.bonusAmount}!`;
                        await notifyUser(interaction.client, report.user_id, bonusMsg);
                    } catch (e) {
                        console.error('Error notifying reporter bonus:', e);
                    }
                }
                
                if (exploitSummary.caughtCount > 0) {
                    await announceExploitSummary(
                        interaction.client,
                        interaction.guild.id,
                        vulnerability.vuln_identifier,
                        exploitSummary
                    );

                    // individual notifications
                    try {
                        const { notifyUser } = require('../utils/logUtils');
                        for (const detail of exploitSummary.caughtDetails || []) {
                            const note = `⚠️ Your exploit on **${vulnerability.vuln_identifier}** was caught during patching. ` +
                                `A fine of $${detail.fineAmount} has been applied.`;
                            await notifyUser(interaction.client, detail.userId, note);
                        }
                    } catch (e) {
                        console.error('Error notifying dashboard for caught exploits:', e);
                    }
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
            reason = "The company is happy with this offer!";
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
                reason = `The company responded with a final offer of $${finalOfferAmount}.`;
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
                        reputation_earned: repBonus,
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

                        try {
                            const { notifyUser } = require('../utils/logUtils');
                            for (const detail of exploitSummary.caughtDetails || []) {
                                const note = `⚠️ Your exploit on **${vulnerability.vuln_identifier}** was caught during patching. ` +
                                    `A fine of $${detail.fineAmount} has been applied.`;
                                await notifyUser(interaction.client, detail.userId, note);
                            }
                        } catch (e) {
                            console.error('Error notifying dashboard for caught exploits:', e);
                        }
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

    // Spam prevention: check if user already responded
    if (offer.user_responded) {
        return interaction.reply({
            content: '⚠️ You already responded to this offer. Only one response per offer is allowed.',
            ephemeral: true
        });
    }

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
        const repBonus = Number(offer.reputation_offered || offer.repuatation_offered || 0);
        if (money > 0) {
            await User.updateOne({_id: u._id}, {$inc: {money_earned: money, reputation_earned: repBonus, money_from_reports: money}});
        } else if (repBonus) {
            await User.updateOne({_id: u._id}, {$inc: {reputation_earned: repBonus}});
        }

        // voucher payout if applicable
        if (offer.voucher_user_id && offer.voucher_amount && offer.voucher_amount > 0) {
            try {
                await User.updateOne({_id: offer.voucher_user_id}, {
                    $inc: {money_earned: offer.voucher_amount, balance: offer.voucher_amount, money_from_vouches: offer.voucher_amount}
                });
                const voucherDoc = await User.findById(offer.voucher_user_id).lean();
                if (voucherDoc) {
                    // notify voucher via dashboard channel
                    try {
                        const { notifyUser } = require('../utils/logUtils');
                        await notifyUser(interaction.client, voucherDoc._id,
                            `💸 You received $${offer.voucher_amount} for vouching on a report!`);
                    } catch (e) {
                        console.error('Voucher notification failed:', e);
                    }
                }
            } catch (e) {
                console.error('Error paying voucher share:', e);
            }
        }

        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'accepted', resolved_at: new Date(), user_responded: true, responded_at: new Date()}});

        // compose breakdown message using stored base and bonus details if available
        let breakdownMsg = '';
        if (offer.base_amount || offer.bonus_details) {
            const base = offer.base_amount || money;
            const bd = offer.bonus_details || {};
            breakdownMsg = `\n**Breakdown:**\n• Base: $${base}`;
            if (bd.company) breakdownMsg += `\n• Company bonus: +$${bd.company}`;
            if (bd.reputation) breakdownMsg += `\n• Reputation bonus: +$${bd.reputation}`;
            if (bd.preferred) breakdownMsg += `\n• Preferred vuln bonus: +$${bd.preferred}`;
            if (bd.constant) breakdownMsg += `\n• Reporting bonus: +$${bd.constant}`;
            if (bd.itemCashReduction) breakdownMsg += `\n• Cash reduced for item: -$${bd.itemCashReduction}`;
        }

        const msg = `You accepted the offer and received $${money}` + (offer.items?.length ? ` and ${offer.items.length} item(s).` : '.') + breakdownMsg;

        const vulnerability = await Vulnerability.findById(report.vulnerability_id);
        if (vulnerability) {
            vulnerability.isResolved = true;
            vulnerability.is_resolved_date = new Date();
            await vulnerability.save();

            // Award bonus to reporter if they're not exploiting
            const bonusResult = await awardReporterBonus(report.user_id, vulnerability._id);

            if (interaction.guild) {
                await announceVulnerabilityPatched(
                    interaction.client,
                    vulnerability,
                    offer,
                    interaction.guild.id
                );

                // Handle exploit cleanup and announcement
                const exploitSummary = await handleExploitCleanup(vulnerability._id);
                
                // Notify reporter about bonus
                if (bonusResult.awarded) {
                    try {
                        const { notifyUser } = require('../utils/logUtils');
                        const bonusMsg = `🎁 **Bonus Reward!** You caught ${bonusResult.exploiterCount} exploiter${bonusResult.exploiterCount > 1 ? 's' : ''} on **${vulnerability.vuln_identifier}**. ` +
                            `You received a bonus of $${bonusResult.bonusAmount}!`;
                        await notifyUser(interaction.client, report.user_id, bonusMsg);
                    } catch (e) {
                        console.error('Error notifying reporter bonus:', e);
                    }
                }
                
                if (exploitSummary.caughtCount > 0) {
                    await announceExploitSummary(
                        interaction.client,
                        interaction.guild.id,
                        vulnerability.vuln_identifier,
                        exploitSummary
                    );

                    try {
                        const { notifyUser } = require('../utils/logUtils');
                        for (const detail of exploitSummary.caughtDetails || []) {
                            const note = `⚠️ Your exploit on **${vulnerability.vuln_identifier}** was caught during patching. ` +
                                `A fine of $${detail.fineAmount} has been applied.`;
                            await notifyUser(interaction.client, detail.userId, note);
                        }
                    } catch (e) {
                        console.error('Error notifying dashboard for caught exploits:', e);
                    }
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
        await CompanyOffer.updateOne({_id: offer._id}, {$set: {status: 'rejected', resolved_at: new Date(), user_responded: true, responded_at: new Date()}});
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

    // Spam prevention: check if user already responded
    if (offer.user_responded) {
        return interaction.reply({
            content: '⚠️ You already responded to this offer. Only one response per offer is allowed.',
            ephemeral: true
        });
    }

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
            reputation_earned: rep
        }
    });

    // voucher share
    if (offer.voucher_user_id && offer.voucher_amount && offer.voucher_amount > 0) {
        try {
            await User.updateOne({_id: offer.voucher_user_id}, {
                $inc: {money_earned: offer.voucher_amount, balance: offer.voucher_amount, money_from_vouches: offer.voucher_amount}
            });
            const voucherDoc = await User.findById(offer.voucher_user_id).lean();
            if (voucherDoc) {
                const { notifyUser } = require('../utils/logUtils');
                await notifyUser(interaction.client, voucherDoc._id,
                    `💸 You received $${offer.voucher_amount} for vouching on a report!`);
            }
        } catch (e) {
            console.error('Error paying voucher share (dictator):', e);
        }
    }

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
            resolved_at: new Date(),
            user_responded: true,
            responded_at: new Date()
        }
    });

    const vulnerability = await Vulnerability.findById(report.vulnerability_id);
    if (vulnerability) {
        vulnerability.isResolved = true;
        vulnerability.is_resolved_date = new Date();
        await vulnerability.save();

        // Award bonus to reporter if they're not exploiting
        const bonusResult = await awardReporterBonus(report.user_id, vulnerability._id);

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
            
            // Notify reporter about bonus
            if (bonusResult.awarded) {
                try {
                    const { notifyUser } = require('../utils/logUtils');
                    const bonusMsg = `🎁 **Bonus Reward!** You caught ${bonusResult.exploiterCount} exploiter${bonusResult.exploiterCount > 1 ? 's' : ''} on **${vulnerability.vuln_identifier}**. ` +
                        `You received a bonus of $${bonusResult.bonusAmount}!`;
                    await notifyUser(interaction.client, report.user_id, bonusMsg);
                } catch (e) {
                    console.error('Error notifying reporter bonus:', e);
                }
            }
            
            if (exploitSummary.caughtCount > 0) {
                await announceExploitSummary(
                    interaction.client,
                    interaction.guild.id,
                    vulnerability.vuln_identifier,
                    exploitSummary
                );

                try {
                    const { notifyUser } = require('../utils/logUtils');
                    for (const detail of exploitSummary.caughtDetails || []) {
                        const note = `⚠️ Your exploit on **${vulnerability.vuln_identifier}** was caught during patching. ` +
                            `A fine of $${detail.fineAmount} has been applied.`;
                        await notifyUser(interaction.client, detail.userId, note);
                    }
                } catch (e) {
                    console.error('Error notifying dashboard for caught exploits:', e);
                }
            }
        }
    }

    // construct breakdown if possible
    let breakdownMsg = '';
    if (offer.base_amount || offer.bonus_details) {
        const baseAmt = offer.base_amount || money;
        let chosenBase = baseAmt;
        if (choice === 'option2') {
            chosenBase = Math.floor(baseAmt * 0.7);
        }
        const bd = offer.bonus_details || {};
        breakdownMsg = `\n**Breakdown:**\n• Base: $${chosenBase}`;
        if (bd.company) breakdownMsg += `\n• Company bonus: +$${bd.company}`;
        if (bd.constant) breakdownMsg += `\n• Reporting bonus: +$${bd.constant}`;
        if (bd.luckyToken) breakdownMsg += `\n• Lucky token applied (payout doubled)`;
        if (bd.itemCashReduction) breakdownMsg += `\n• Cash reduced for item: -$${bd.itemCashReduction}`;
    }

    const msg = `You chose ${choice === 'option1' ? 'Option 1' : 'Option 2'} and received $${money}${rep ? ` and +${rep} reputation` : ''}` + (offer.items?.length ? ` and ${offer.items.length} item(s).` : '.') + breakdownMsg;
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
    const constBonus2 = Number(process.env.CONSTANT_REPORT_BONUS || 0);
    const finalMoney = Math.floor(selected.money * totalMultiplier) + constBonus2;

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
                reputation_earned: selected.rep,
            },
        }
    );

    await updateCompanyReputation(user._id, report.company_id, 3);

    // construct bonus breakdown for the user
    let bonusMsg = '';
    if (reputationBonus || preferredBonus || constBonus2) {
        bonusMsg = `\n**Bonuses applied:**`;
        if (reputationBonus) bonusMsg += `\n• Reputation (${reputationBonus*100}%): +$${Math.floor(selected.money * reputationBonus)}`;
        if (preferredBonus) bonusMsg += `\n• Preferred vuln (${preferredBonus*100}%): +$${Math.floor(selected.money * preferredBonus)}`;
        if (constBonus2) bonusMsg += `\n• Reporting bonus: +$${constBonus2}`;
    }

    if (interaction.deferred || interaction.replied) {
        await interaction.followUp({
            content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**\n` +
                `**Money:** $${finalMoney} (base: $${selected.money})` + bonusMsg + `\n` +
                `**Reputation:** ${selected.rep}`,
            ephemeral: true,
        });
    } else {
        await interaction.update({
            content: `You chose **${action === 'option1' ? 'Option 1' : 'Option 2'}**\n` +
                `**Money:** $${finalMoney} (base: $${selected.money})` + bonusMsg + `\n` +
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
    const trade = await Trade.findById(tradeId).lean();
    if (!trade) {
        return interaction.reply({content: 'Trade not found.', ephemeral: true});
    }

    const [givingUser, receivingUser, currentUser] = await Promise.all([
        User.findById(trade.giving_user_id).lean(),
        User.findById(trade.receiving_user_id).lean(),
        User.findOne({discord_id: interaction.user.id}).lean()
    ]);

    if (!currentUser) {
        return interaction.reply({content: 'User not found.', ephemeral: true});
    }

    const isGiver = trade.giving_user_id.toString() === currentUser._id.toString();
    const isReceiver = trade.receiving_user_id.toString() === currentUser._id.toString();

    if (!isGiver && !isReceiver) {
        return interaction.reply({content: 'You are not part of this trade.', ephemeral: true});
    }

    if (action === 'reject') {
        await rejectTrade(interaction, tradeId, isGiver ? receivingUser : givingUser);
        return;
    }

    if (isReceiver && action === 'accept' && trade.status === 'pending') {
        const selection = await selectReceiverTradeValue(interaction, receivingUser, trade);
        if (!selection) return;

        await Trade.updateOne(
            {_id: tradeId, status: 'pending'},
            {$set: {ru_value: selection.value, status: 'receiver_selected'}}
        );

        const updatedTrade = await Trade.findById(tradeId).lean();
        const summary = await formatTradeSummary(updatedTrade);
        const updatePayload = {
            content: `You selected your side of the trade.\n\n${summary}\n\nWaiting for both final confirmations.`,
            components: []
        };
        if (selection.acknowledged) {
            await interaction.message.edit(updatePayload);
        } else {
            await interaction.update(updatePayload);
        }

        const {ActionRowBuilder, ButtonBuilder, ButtonStyle} = require('discord.js');
        const finalButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`trade_confirm_${tradeId}`)
                .setLabel('Confirm Final Trade')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`trade_reject_${tradeId}`)
                .setLabel('Decline')
                .setStyle(ButtonStyle.Danger)
        );

        const {notifyUser} = require('../utils/logUtils');
        const finalMessage = {content: `**Final Trade Verification**\n\n${summary}\n\nConfirm to complete this trade.`, components: [finalButtons]};
        await notifyUser(interaction.client, givingUser._id, finalMessage);
        await notifyUser(interaction.client, receivingUser._id, finalMessage);
        return;
    }

    if (action === 'confirm' && trade.status === 'receiver_selected') {
        await Trade.updateOne(
            {_id: tradeId, status: 'receiver_selected'},
            isGiver ? {$set: {giver_confirmed: true}} : {$set: {receiver_confirmed: true}}
        );

        const freshTrade = await Trade.findById(tradeId).lean();
        if (!(freshTrade.giver_confirmed && freshTrade.receiver_confirmed)) {
            await interaction.update({content: 'You confirmed the trade. Waiting for the other player.', components: []});
            return;
        }

        try {
            await executeTrade(freshTrade);
            await Trade.updateOne({_id: tradeId}, {status: 'completed', resolved_at: new Date()});

            await interaction.update({content: 'Trade completed successfully!', components: []});

            const {notifyUser} = require('../utils/logUtils');
            const msg = {content: 'Trade completed successfully.'};
            await notifyUser(interaction.client, givingUser._id, msg);
            await notifyUser(interaction.client, receivingUser._id, msg);
        } catch (err) {
            console.error('Final trade error:', err);
            await Trade.updateOne({_id: tradeId}, {status: 'rejected', resolved_at: new Date()});
            await interaction.update({
                content: 'Trade failed because one player no longer has the required money, item, or vulnerability.',
                components: []
            });
        }
        return;
    }

    return interaction.reply({content: 'This trade is no longer waiting for that action.', ephemeral: true});
}

async function rejectTrade(interaction, tradeId, otherUser) {
    await Trade.updateOne({_id: tradeId}, {status: 'rejected', resolved_at: new Date()});
    await interaction.update({content: 'Trade declined.', components: []});

    try {
        const {notifyUser} = require('../utils/logUtils');
        await notifyUser(interaction.client, otherUser._id, {
            content: `Trade declined. ${interaction.user.username} declined the trade.`
        });
    } catch (err) {
        console.error('Dashboard trade rejection notify failed:', err);
    }
}

async function selectReceiverTradeValue(interaction, receivingUser, trade) {
    if (trade.ru_item_type === 'money') {
        const balance = Number(receivingUser.balance ?? receivingUser.money_earned ?? 0);
        if (balance < Number(trade.ru_value || 0)) {
            await interaction.reply({content: 'You do not have enough money for this trade.', ephemeral: true});
            return null;
        }
        return {value: trade.ru_value, acknowledged: false};
    }

    const {ActionRowBuilder, StringSelectMenuBuilder, ComponentType} = require('discord.js');

    if (trade.ru_item_type === 'vulnerability') {
        const vulnerabilities = await Vulnerability.find({
            isResolved: false,
            'visibility.allowedUsers': receivingUser._id
        }).lean();

        if (!vulnerabilities.length) {
            await interaction.reply({content: 'You have no vulnerabilities available for this trade.', ephemeral: true});
            return null;
        }

        const menu = new StringSelectMenuBuilder()
            .setCustomId(`trade_select_receiver_${trade._id}`)
            .setPlaceholder('Select the vulnerability you will trade')
            .addOptions(vulnerabilities.slice(0, 25).map(v => ({
                label: v.vuln_identifier,
                description: v.volun_type?.slice(0, 100) || 'Vulnerability intel',
                value: v._id.toString()
            })));

        await interaction.update({
            content: 'Select the vulnerability you want to trade:',
            components: [new ActionRowBuilder().addComponents(menu)]
        });

        const response = await interaction.message.awaitMessageComponent({
            componentType: ComponentType.StringSelect,
            filter: i => i.user.id === interaction.user.id && i.customId === `trade_select_receiver_${trade._id}`,
            time: 120000
        }).catch(() => null);

        if (!response) return null;
        await response.deferUpdate();
        return {value: response.values[0], acknowledged: true};
    }

    const userWithInventory = await User.findById(receivingUser._id)
        .populate('inventory.item_id')
        .populate('inventory.company_id');
    const entries = (userWithInventory?.inventory || []).filter(e => e.item_id && (e.qty || 0) > 0);

    if (!entries.length) {
        await interaction.reply({content: 'You have no items available for this trade.', ephemeral: true});
        return null;
    }

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`trade_select_receiver_${trade._id}`)
        .setPlaceholder('Select the item you will trade')
        .addOptions(entries.slice(0, 25).map((entry, index) => ({
            label: entry.item_id.name?.slice(0, 100) || 'Item',
            description: `${entry.company_id?.name ? `${entry.company_id.name} - ` : ''}Qty: ${entry.qty}`.slice(0, 100),
            value: String(index)
        })));

    await interaction.update({
        content: 'Select the item you want to trade:',
        components: [new ActionRowBuilder().addComponents(menu)]
    });

    const response = await interaction.message.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === interaction.user.id && i.customId === `trade_select_receiver_${trade._id}`,
        time: 120000
    }).catch(() => null);

    if (!response) return null;
    await response.deferUpdate();
    const entry = entries[Number(response.values[0])];
    return {value: {
        item_id: entry.item_id._id.toString(),
        company_id: entry.company_id?._id?.toString() || null,
        qty: 1
    }, acknowledged: true};
}

async function executeTrade(trade) {
    await verifyTradeAsset(trade.giving_user_id, trade.gu_item_type, trade.gu_value);
    await verifyTradeAsset(trade.receiving_user_id, trade.ru_item_type, trade.ru_value);
    await transferTradeAsset(trade.giving_user_id, trade.receiving_user_id, trade.gu_item_type, trade.gu_value);
    await transferTradeAsset(trade.receiving_user_id, trade.giving_user_id, trade.ru_item_type, trade.ru_value);
}

async function verifyTradeAsset(userId, type, value) {
    const user = await User.findById(userId).lean();
    if (!user) throw new Error('User not found');

    if (type === 'money') {
        const balance = Number(user.balance ?? user.money_earned ?? 0);
        if (balance < Number(value || 0)) throw new Error('Insufficient funds');
        return;
    }

    if (type === 'vulnerability') {
        const vuln = await Vulnerability.findOne({_id: value, 'visibility.allowedUsers': userId, isResolved: false}).lean();
        if (!vuln) throw new Error('Missing vulnerability');
        return;
    }

    const item = findInventoryEntry(user, value);
    if (!item || (item.qty || 0) < (value.qty || 1)) throw new Error('Missing item');
}

async function transferTradeAsset(fromUserId, toUserId, type, value) {
    if (type === 'money') {
        const amount = Number(value);
        await User.updateOne({_id: fromUserId}, {$inc: {balance: -amount, money_from_trades: -amount}});
        await User.updateOne({_id: toUserId}, {$inc: {balance: amount, money_from_trades: amount}});
        return;
    }

    if (type === 'vulnerability') {
        await Vulnerability.updateOne(
            {_id: value},
            {
                $pull: {'visibility.allowedUsers': fromUserId},
                $addToSet: {
                    'visibility.allowedUsers': toUserId,
                    discovered_by: {user_id: toUserId, discovered_at: new Date()}
                }
            }
        );
        return;
    }

    await removeInventoryItem(fromUserId, value);
    await addInventoryItem(toUserId, value);
}

async function removeInventoryItem(userId, value) {
    const user = await User.findById(userId);
    const index = (user.inventory || []).findIndex(e =>
        String(e.item_id) === String(value.item_id) &&
        String(e.company_id || '') === String(value.company_id || '')
    );
    if (index === -1 || (user.inventory[index].qty || 0) < (value.qty || 1)) throw new Error('Missing item');
    user.inventory[index].qty -= value.qty || 1;
    if (user.inventory[index].qty <= 0) user.inventory.splice(index, 1);
    await user.save();
}

async function addInventoryItem(userId, value) {
    const user = await User.findById(userId);
    const index = (user.inventory || []).findIndex(e =>
        String(e.item_id) === String(value.item_id) &&
        String(e.company_id || '') === String(value.company_id || '')
    );
    if (index === -1) {
        user.inventory.push({item_id: value.item_id, company_id: value.company_id || null, qty: value.qty || 1});
    } else {
        user.inventory[index].qty += value.qty || 1;
    }
    await user.save();
}

function findInventoryEntry(user, value) {
    return (user.inventory || []).find(e =>
        String(e.item_id) === String(value.item_id) &&
        String(e.company_id || '') === String(value.company_id || '')
    );
}

async function formatTradeSummary(trade) {
    const giving = await formatTradeAsset(trade.gu_item_type, trade.gu_value);
    const receiving = await formatTradeAsset(trade.ru_item_type, trade.ru_value);
    return `**Player 1 gives:** ${giving}\n**Player 2 gives:** ${receiving}`;
}

async function formatTradeAsset(type, value) {
    if (type === 'money') return `$${value}`;
    if (type === 'vulnerability') {
        const vuln = await Vulnerability.findById(value).lean();
        return vuln ? vuln.vuln_identifier : 'unknown vulnerability';
    }
    const user = await User.findOne({
        'inventory.item_id': value.item_id,
        ...(value.company_id ? {'inventory.company_id': value.company_id} : {})
    }).populate('inventory.item_id').populate('inventory.company_id').lean();
    const entry = (user?.inventory || []).find(e =>
        String(e.item_id?._id || e.item_id) === String(value.item_id) &&
        String(e.company_id?._id || e.company_id || '') === String(value.company_id || '')
    );
    const company = entry?.company_id?.name ? ` (${entry.company_id.name})` : '';
    return `${entry?.item_id?.name || 'item'}${company}`;
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


