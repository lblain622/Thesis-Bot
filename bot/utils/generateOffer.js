const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const CompanyOffer = require('../../models/CompanyOffers');
const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const User = require('../../models/Users');

/**
 * Generate a CompanyOffer for a submitted report
 * @param {Discord.Client} client
 * @param {Object} report - Report document
 * @param {Discord.User} discordUser
 */
async function generateOffer(client, report, discordUser) {
    // Get company info
    const company = await Company.findById(report.company_id).populate('bounty_tiers');
    if (!company) throw new Error('Company not found');

    // Determine offer based on severity
    const tier = await BountyTier.findOne({ severity: report.volunerablity_sev });
    if (!tier) throw new Error('Bounty tier not found');

    // Random amount within tier range
    const min = parseFloat(tier.min_value);
    const max = parseFloat(tier.max_value);
    const offerAmount = Math.floor(Math.random() * (max - min + 1)) + min;

    const offerMessage = `Your report has been reviewed by **${company.name}**.\nThey offer **$${offerAmount} USD** for your submission.`;


    const offer = await CompanyOffer.create({
        company_id: company._id,
        report_id: report._id,
        user_id: report.user_id,
        original_amount: offerAmount,
        offered_amount: offerAmount,
        offer_percent: 100,
        reputation_offered: 10,
        status: 'pending',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
        counter_offer: null,
    });

    // DM user
    try {
        const dm = await discordUser.send({
            content: `💼 **Reward Offer**\n\n${offerMessage}\n\nDo you accept this offer?`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`offer_accept_${offer._id}`)
                        .setLabel('✅ Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`offer_reject_${offer._id}`)
                        .setLabel('❌ Reject')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId(`offer_counter_${offer._id}`)
                        .setLabel('💬 Counteroffer')
                        .setStyle(ButtonStyle.Secondary)
                ),
            ],
        });

        console.log(`Offer sent to ${discordUser}`);
    } catch (err) {
        console.error(' Could not send DM:', err);
    }
}
module.exports = generateOffer;
