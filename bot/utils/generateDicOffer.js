const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const CompanyOffer = require('../../models/CompanyOffers');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function generateDictatorOffer(client, report, discordUser) {
  const company = await Company.findById(report.company_id).populate('bounty_tiers');
  const tier = await BountyTier.findOne({ severity: report.volunerablity_sev });

  const matchingTier =
    company.bounty_tiers.find((t) => t.severity === report.volunerablity_sev) || tier;

  const min = matchingTier?.min_value || 100;
  const max = matchingTier?.max_value || 500;
  const base = Math.floor(Math.random() * (max - min + 1)) + min;

  const options = {
    option1: { money: base, rep: 0 },
    option2: { money: Math.floor(base * 0.7), rep: 50 },
  };

  const offer = await CompanyOffer.create({
    company_id: company._id,
    report_id: report._id,
    user_id: report.user_id,
    dictator_options: options,
    status: 'pending',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });

  await discordUser.send({
    content:
      `Offer from ${company.name}\n Report\n` +
      `Option 1: $${options.option1.money} + ${options.option1.rep} reputation\n` +
      `Option 2: $${options.option2.money} + ${options.option2.rep} reputation\n\n` +
      `Please choose one:`,
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
}

module.exports = generateDictatorOffer;
