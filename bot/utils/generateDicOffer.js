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

async function generateDictatorOffer(client, report, discordUser) {
    const company = await Company.findById(report.company_id).populate('bounty_tiers');
    const tier = await BountyTier.findOne({severity: report.volunerablity_sev});

    const matchingTier =
        company.bounty_tiers.find((t) => t.severity === report.volunerablity_sev) || tier;

    const min = matchingTier?.min_value || 100;
    const max = matchingTier?.max_value || 500;
    // keep track of the starting base value for breakdown
    const baseRand = Math.floor(Math.random() * (max - min + 1)) + min;
    let base = baseRand;

    // bonus breakdown structure (applies to base)
    const bonusDetails = {
        company: 0,
        constant: 0,
        luckyToken: 0
    };

    // Apply shop effects: company bonus and lucky token (affect monetary parts)
    let notes = [];
    try {
        const user = await Users.findById(report.user_id).lean();
        if (user) {
            const inv = await fetchInventoryItems(user);
            const bonusPct = computeCompanyBonusPct(inv, company._id);
            if (bonusPct > 0) {
                const bonusAmt = Math.floor(baseRand * (bonusPct / 100));
                bonusDetails.company = bonusAmt;
                base += bonusAmt; // scale base so both options scale
                notes.push(`+${bonusPct}% company bonus`);
            }
            const luck = await maybeConsumeLuckyToken(user._id);
            if (luck.triggered) {
                bonusDetails.luckyToken = base;
                base *= 2;
                notes.push('Lucky Token doubled payout');
            }
        }
    } catch (_) {
    }

    // constant reporting bonus (flat)
    const CONSTANT_REPORT_BONUS = Number(process.env.CONSTANT_REPORT_BONUS || 0);
    if (CONSTANT_REPORT_BONUS) {
        bonusDetails.constant = CONSTANT_REPORT_BONUS;
        base += CONSTANT_REPORT_BONUS;
        notes.push(`+ $${CONSTANT_REPORT_BONUS} report bonus`);
    }

    // Optionally attach an item and reduce cash (applies to both options)
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
                base = Math.max(minCash, Math.floor(base * (1 - reducePct / 100)));
                reductionReason = 'item_bonus';
            }
        } catch (_) {
        }
    }

    const options = {
        option1: {money: base, rep: 0},
        option2: {money: Math.floor(base * 0.7), rep: 50},
    };

    const offer = await CompanyOffer.create({
        company_id: company._id,
        report_id: report._id,
        user_id: report.user_id,
        base_amount: baseRand,
        bonus_details: bonusDetails,
        dictator_options: options,
        status: 'pending',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        items: attachedItems,
        cash_reduction_reason: reductionReason,
    });

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
        ? `\nIncluded Item${attachedItems.length > 1 ? 's' : ''}: ` + attachedItems.map(ai => ai.name || '1x bonus item').join(', ')
        : '';
    
    // build breakdown for the base payout
    let breakdown = `\n\n**Breakdown:**\n` +
        `• Base payout: $${baseRand}`;
    if (bonusDetails.company) breakdown += `\n• Company bonus: +$${bonusDetails.company}`;
    if (bonusDetails.constant) breakdown += `\n• Reporting bonus: +$${bonusDetails.constant}`;
    if (bonusDetails.luckyToken) breakdown += `\n• Lucky token added (payout doubled)`;

    const messageContent = `${discordUser} 🎲 **Dictator Offer from ${company.name}**\n` +
        `Report received. Choose one option:\n` +
        `Option 1: $${options.option1.money} + ${options.option1.rep} reputation\n` +
        `Option 2: $${options.option2.money} + ${options.option2.rep} reputation` +
        breakdown +
        (reductionReason ? `\nNote: Cash reduced due to item bonus.` : '') +
        (notes.length ? `\nApplied: ${notes.join(', ')}` : '') +
        itemsLine +
        `${grantMsg}\n\n` +
        `Please choose one:`;

    try {
        // Send private notification to the user only (not public channel)
        const { notifyUser } = require('./logUtils');
        await notifyUser(client, report.user_id, messageContent, {
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`dictator_option1_${offer._id}`)
                        .setLabel('Choose Option 1')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`dictator_option2_${offer._id}`)
                        .setLabel('Choose Option 2')
                        .setStyle(ButtonStyle.Primary)
                ),
            ],
        });
    } catch (e) {
        console.error('Dictator offer notification failed:', e);
    }
}

module.exports = generateDictatorOffer;
