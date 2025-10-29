const Company = require('../models/Company');
const CompanyOffer = require('../models/CompanyOffers');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

async function generateDictatorOffer(client, report, discordUser) {
  const company = await Company.findById(report.company_id);

  // Example options — can be customized per company later
  const options = {
    option1: { money: 500, rep: 0 },   // Money-only
    option2: { money: 300, rep: 50 },  // Recognition-heavy
  };

  // Create offer in DB
  const offer = await CompanyOffer.create({
    company_id: company._id,
    report_id: report._id,
    user_id: report.user_id,
    dictator_options: options,
    dictator_choice: null,
    status: 'pending',
    created_at: new Date(),
    expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });

  // Send DM to user
  try {
    await discordUser.send({
      content:
        `You have recieved an offer from **${company.name}**\n\n` +
        `You have two options:\n\n` +
        `**Option 1:** $${options.option1.money} + ${options.option1.rep} reputation\n` +
        `**Option 2:** $${options.option2.money} + ${options.option2.rep} reputation\n\n` +
        `Please choose your preferred reward.`,
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
  } catch (err) {
    console.error('Failed to DM dictator offer:', err);
  }
}

module.exports = { generateDictatorOffer };
