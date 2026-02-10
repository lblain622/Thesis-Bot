const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const CompanyOffer = require('../../models/CompanyOffers');
const Items = require('../../models/Items');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { fetchInventoryItems, computeCompanyBonusPct, maybeConsumeLuckyToken, grantMerchantHatIfMissing } = require('./shopEffects');
const Users = require('../../models/Users');

async function generateOffer(client, report, discordUser) {
    const company = await Company.findById(report.company_id).populate('bounty_tiers');
    const tier = await BountyTier.findOne({ severity: report.volunerablity_sev });

    const min = parseFloat(tier?.min_value || 50);
    const max = parseFloat(tier?.max_value || 500);
    let offerAmount = Math.floor(Math.random() * (max - min + 1)) + min;

    // Apply shop effects: company bonus and lucky token
    let notes = [];
    try {
        const user = await Users.findById(report.user_id).lean();
        if (user) {
            const inv = await fetchInventoryItems(user);
            const bonusPct = computeCompanyBonusPct(inv, company._id);
            if (bonusPct > 0) {
                const bonusAmt = Math.floor(offerAmount * (bonusPct / 100));
                offerAmount += bonusAmt;
                notes.push(`+${bonusPct}% company bonus`);
            }
            const luck = await maybeConsumeLuckyToken(user._id);
            if (luck.triggered) {
                offerAmount *= 2;
                notes.push('Lucky Token doubled payout');
            }
        }
    } catch (_) { /* ignore */ }

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
            const pool = await Items.find({ enabled: true, type: { $in: ['merch', 'tool'] } }).lean();
            if (pool.length) {
                // Simple weighted by inverse price to bias affordable items
                const chosen = pool.sort(() => 0.5 - Math.random()).slice(0, Math.min(1, maxItems));
                for (const it of chosen) {
                    const entry = { item_id: it._id, qty: 1 };
                    if (it.type === 'merch' && it.companyScoped) entry.company_id = company._id;
                    attachedItems.push(entry);
                }
                // Reduce cash
                const reduced = Math.floor(offerAmount * (1 - reducePct / 100));
                offerAmount = Math.max(minCash, reduced);
                reductionReason = 'item_bonus';
            }
        } catch (e) { /* ignore */ }
    }

    const offer = await CompanyOffer.create({
        company_id: company._id,
        report_id: report._id,
        user_id: report.user_id,
        original_amount: offerAmount,
        offered_amount: offerAmount,
        offer_percent: 100,
        reputation_offered: '10',
        status: 'pending',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        counter_offer: null,
        items: attachedItems,
        cash_reduction_reason: reductionReason,
    });

    try {
        // 20% chance to grant a Merchant Hat for this company if not owned
        let grantMsg = '';
        try {
            if (Math.random() < 0.2) {
                const granted = await grantMerchantHatIfMissing(report.user_id, company._id);
                if (granted) grantMsg = `\nBonus item granted: Merchant Hat for ${company.name}!`;
            }
        } catch (_) {}

        const itemsLine = attachedItems.length
            ? `\nIncluded Item${attachedItems.length>1?'s':''}: ` + attachedItems.map(ai => {
                const it = (ai && ai.item_id) ? ai.item_id : null; // not populated here
                // we only have ids, so show generic label
                return `1x bonus item`;
            }).join(', ')
            : '';
        await discordUser.send({
            content: `Reward Offer from ${company.name}\n` +
                `You have an offer of $${offerAmount} for your report.` +
                (reductionReason ? `\nNote: Cash reduced due to item bonus.` : '') +
                (notes.length ? `\nApplied: ${notes.join(', ')}` : '') +
                `${itemsLine}${grantMsg}\n` +
                `Do you accept this offer?`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`offer_accept_${offer._id}`)
                        .setLabel('Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`offer_reject_${offer._id}`)
                        .setLabel('Reject')
                        .setStyle(ButtonStyle.Danger)
                ),
                    new ButtonBuilder()
                        .setCustomId(`offer_counter_${offer._id}`)
                        .setLabel('Counter Offer')
                        .setStyle(ButtonStyle.Secondary)
                ),
            ],
        });
    } catch (err) {
        console.error('Could not send DM:', err);
    }
}

module.exports = generateOffer ;
