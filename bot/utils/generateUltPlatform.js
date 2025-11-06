require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');

async function generateUltPlatform() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    let platform = await Platform.findOne({ name: 'Ultimatum Test Platform' });
    if (!platform) {
      platform = await Platform.create({
        name: 'Ultimatum Test Platform',
        description: 'Ultimatum Game Testing Platform',
        base_policies: {
          response_speed: 'Fast',
          safe_harbor: 'Yes',
          payout_speed: 'Immediate',
          overall_transparency: 'Variable',
          offer_multiplier: '1.0',
        },
      });
    }

    // Create Bounty Tiers
    const tiersData = [
      { severity: 'low', min_value: 50, max_value: 150, description: 'Minor issue' },
      { severity: 'medium', min_value: 200, max_value: 400, description: 'Moderate issue' },
      { severity: 'high', min_value: 500, max_value: 800, description: 'High-impact issue' },
      { severity: 'critical', min_value: 1000, max_value: 2000, description: 'Severe critical issue' },
    ];

    const bountyTiers = [];
    for (const tier of tiersData) {
      const existing = await BountyTier.findOne({ severity: tier.severity });
      bountyTiers.push(existing || (await BountyTier.create(tier)));
    }

    const companies = [
      {
        name: 'FairCorp',
        description: 'High transparency, fair offers.',
        platform_id: platform._id,
        bounty_tiers: bountyTiers.map((t) => t._id),
      },
      {
        name: 'Lowball Inc',
        description: 'Low transparency, unfair offers.',
        platform_id: platform._id,
        bounty_tiers: bountyTiers.map((t) => t._id),
      },
      {
        name: 'ReputationX',
        description: 'Offers mix of money and reputation.',
        platform_id: platform._id,
        bounty_tiers: bountyTiers.map((t) => t._id),
      },
    ];

    for (const data of companies) {
      const exists = await Company.findOne({ name: data.name });
      if (!exists) await Company.create(data);
    }

    console.log('Platform + Companies + Bounty tiers generated successfully.');
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
}

generateUltPlatform();
