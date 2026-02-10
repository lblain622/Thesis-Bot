const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const CompanyOffer = require('../../models/CompanyOffers');
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

        await discordUser.send({
            content: `Reward Offer from ${company.name}\n` +
                `You have an offer of $${offerAmount} for your report.` +
                (notes.length ? `\nApplied: ${notes.join(', ')}` : '') +
                `${grantMsg}\n` +
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
//                    new ButtonBuilder()
//                        .setCustomId(`offer_counter_${offer._id}`)
//                        .setLabel('Counter Offer')
//                        .setStyle(ButtonStyle.Secondary)
//                ),
            ],
        });
    } catch (err) {
        console.error('Could not send DM:', err);
    }
}

module.exports = generateOffer ;
