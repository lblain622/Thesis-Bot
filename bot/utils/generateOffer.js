const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const CompanyOffer = require('../../models/CompanyOffers');
const Items = require('../../models/Items');
const {ActionRowBuilder, ButtonBuilder, ButtonStyle} = require('discord.js');
const {
    fetchInventoryItems,
    computeCompanyBonusPct,
    maybeConsumeLuckyToken,
    grantMerchantHatIfMissing
} = require('./shopEffects');
const Users = require('../../models/Users');

async function generateOffer(client, report, discordUser) {
    const company = await Company.findById(report.company_id).populate('bounty_tiers');
    const tier = await BountyTier.findOne({severity: report.volunerablity_sev});

    const min = parseFloat(tier?.min_value || 50);
    const max = parseFloat(tier?.max_value || 500);
    // keep the original random base for breakdown
    const baseAmount = Math.floor(Math.random() * (max - min + 1)) + min;
    let offerAmount = baseAmount;

    // determine voucher split now that we know base amount
    let voucherShare = 0;
    let voucherDoc = null;
    if (report.VouchingUser) {
        voucherDoc = await Users.findById(report.VouchingUser).lean();
    }

    const bonusDetails = {
        company: 0,
        reputation: 0,
        preferred: 0,
        constant: 0,
        luckyToken: 0,
        itemCashReduction: 0
    };

    // Apply shop effects: company bonus
    let notes = [];

    // check reputation threshold for voucher eligibility
    const repThresh = company.reputation_threshold || 0;
    if (voucherDoc && repThresh > 0) {
        const user = await Users.findById(report.user_id).lean();
        const userMeets = user && (user.reputation || 0) >= repThresh;
        const voucherMeets = (voucherDoc.reputation || 0) >= repThresh;
        if (userMeets || voucherMeets) {
            const pct = Number(process.env.VOUCHER_SHARE_PCT || 20);
            voucherShare = Math.floor(offerAmount * (pct / 100));
            if (voucherShare > 0) {
                offerAmount -= voucherShare;
                notes.push(`$${voucherShare} reserved for voucher (${voucherDoc.username || voucherDoc.discord_id})`);
            }
        }
    }
    try {
        const user = await Users.findById(report.user_id).lean();
        if (user) {
            const inv = await fetchInventoryItems(user);
            const bonusPct = computeCompanyBonusPct(inv, company._id);
            if (bonusPct > 0) {
                const bonusAmt = Math.floor(baseAmount * (bonusPct / 100));
                bonusDetails.company = bonusAmt;
                offerAmount += bonusAmt;
                notes.push(`+${bonusPct}% company bonus`);
            }
            const luck = await maybeConsumeLuckyToken(user._id);
            if (luck.triggered) {
                bonusDetails.luckyToken = offerAmount; // doubled value, treat as extra = offerAmount
                offerAmount *= 2;
                notes.push('Lucky Token doubled payout');
            }
        }
    } catch (_) { /* ignore */
    }

    // constant reporting bonus (flat amount added to every offer)
    const CONSTANT_REPORT_BONUS = Number(process.env.CONSTANT_REPORT_BONUS || 0);
    if (CONSTANT_REPORT_BONUS) {
        bonusDetails.constant = CONSTANT_REPORT_BONUS;
        offerAmount += CONSTANT_REPORT_BONUS;
        notes.push(`+ $${CONSTANT_REPORT_BONUS} report bonus`);
    }

    // apply reputation / preferred vuln bonuses if present on the report (percentages)
    try {
        if (report.reputation_bonus) {
            const repAmt = Math.floor(baseAmount * (report.reputation_bonus / 100));
            bonusDetails.reputation = repAmt;
            offerAmount += repAmt;
            notes.push(`+${report.reputation_bonus}% rep bonus`);
        }
        if (report.preferred_vuln_bonus) {
            const prefAmt = Math.floor(baseAmount * (report.preferred_vuln_bonus / 100));
            bonusDetails.preferred = prefAmt;
            offerAmount += prefAmt;
            notes.push(`+${report.preferred_vuln_bonus}% preferred vuln bonus`);
        }
    } catch (_) {}

    // Maybe attach an item and reduce cash
    let attachedItems = [];
    let reductionReason = null;
    const withItemsEnabled = process.env.OFFERS_WITH_ITEMS_ENABLED === 'true';
    const attachChance = Number(process.env.OFFERS_ITEM_ATTACH_CHANCE || 0.35);
    const reducePct = Number(process.env.OFFERS_ITEM_CASH_REDUCT_PCT || 60);
    const minCash = Number(process.env.OFFERS_ITEM_MIN_CASH || 50);
    const maxItems = Number(process.env.OFFERS_MAX_ITEMS_PER_OFFER || 1);

    if (withItemsEnabled && Math.random() < attachChance) {
        try {
            const pool = await Items.find({enabled: true, type: {$in: ['merch', 'tool']}}).lean();
            if (pool.length) {
                // Bias towards companyScoped (branded) items
                const brandedPool = pool.filter(it => it.companyScoped);
                const generalPool = pool.filter(it => !it.companyScoped);

                let candidates = [];
                if (brandedPool.length && Math.random() < 0.7) {
                    candidates = brandedPool;
                } else {
                    candidates = pool;
                }

                const chosen = candidates.sort(() => 0.5 - Math.random()).slice(0, Math.min(1, maxItems));
                for (const it of chosen) {
                    const entry = {item_id: it._id, qty: 1, name: it.name};
                    if (it.companyScoped) entry.company_id = company._id;
                    attachedItems.push(entry);
                }
                // Reduce cash
                const reduced = Math.floor(offerAmount * (1 - reducePct / 100));
                // record how much cash was removed as item bonus
                const reduction = offerAmount - Math.max(minCash, reduced);
                bonusDetails.itemCashReduction = reduction;
                offerAmount = Math.max(minCash, reduced);
                reductionReason = 'item_bonus';
            }
        } catch (e) { /* ignore */
        }
    }

    const offer = await CompanyOffer.create({
        company_id: company._id,
        report_id: report._id,
        user_id: report.user_id,
        base_amount: baseAmount,
        bonus_details: bonusDetails,
        original_amount: offerAmount + voucherShare, // keep pre-split figure for record
        offered_amount: offerAmount,
        offer_percent: 100,
        reputation_offered: '10',
        status: 'pending',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        counter_offer: null,
        items: attachedItems,
        cash_reduction_reason: reductionReason,
        voucher_user_id: voucherDoc?._id || null,
        voucher_amount: voucherShare,
    });

    try {
        // 20% chance to grant a Merchant Hat for this company if not owned
        let grantMsg = '';
        try {
            if (Math.random() < 0.2) {
                const granted = await grantMerchantHatIfMissing(report.user_id, company._id);
                if (granted) grantMsg = `\nBonus item granted: Merchant Hat for ${company.name}!`;
            }
        } catch (_) {
        }

        const itemsLine = attachedItems.length
            ? `\nIncluded Item${attachedItems.length > 1 ? 's' : ''}: ` + attachedItems.map(ai => {
            return ai.name || '1x bonus item';
        }).join(', ')
            : '';
        
        // build breakdown snippet using the data we calculated earlier
        let breakdown = `\n\n**Breakdown:**\n` +
            `• Base payout: $${baseAmount}`;
        if (bonusDetails.company) breakdown += `\n• Company bonus: +$${bonusDetails.company}`;
        if (bonusDetails.reputation) breakdown += `\n• Reputation bonus: +$${bonusDetails.reputation}`;
        if (bonusDetails.preferred) breakdown += `\n• Preferred vuln bonus: +$${bonusDetails.preferred}`;
        if (bonusDetails.constant) breakdown += `\n• Reporting bonus: +$${bonusDetails.constant}`;
        if (bonusDetails.luckyToken) breakdown += `\n• Lucky token added (payout doubled)`;
        if (bonusDetails.itemCashReduction) breakdown += `\n• Cash reduced for included item: -$${bonusDetails.itemCashReduction}`;

        let messageContent = `${discordUser} 💰 **Reward Offer from ${company.name}**\n` +
            `You have an offer of $${offerAmount} for your report.`;
        if (voucherShare && voucherDoc) {
            messageContent += `\n($${voucherShare} has been set aside for your voucher ${voucherDoc.username || voucherDoc.discord_id}).`;
        }
        messageContent += breakdown +
            (reductionReason ? `\nNote: Cash reduced due to item bonus.` : '') +
            (notes.length ? `\nApplied: ${notes.join(', ')}` : '') +
            `${itemsLine}${grantMsg}\n` +
            `Do you accept this offer?`;

        try {
            // Send private notification to the user only (not public channel)
            const { notifyUser } = require('./logUtils');
            await notifyUser(client, report.user_id, messageContent, {
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`offer_accept_${offer._id}`)
                            .setLabel('Accept')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`offer_reject_${offer._id}`)
                            .setLabel('Reject')
                            .setStyle(ButtonStyle.Danger),
                        new ButtonBuilder()
                            .setCustomId(`offer_counter_${offer._id}`)
                            .setLabel('Counter Offer')
                            .setStyle(ButtonStyle.Secondary)
                    ),
                ],
            });
        } catch (e) {
            console.error('Offer notification failed:', e);
        }
    } catch (err) {
        console.error('Error generating offer:', err);
    }
}

module.exports = generateOffer;
