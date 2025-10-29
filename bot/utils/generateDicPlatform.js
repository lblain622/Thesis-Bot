require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');

async function generateDictatorPlatform() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('MongoDB connected');

    let platform = await Platform.findOne({ name: 'Dictator Test Platform' });
    if (!platform) {
      platform = await Platform.create({
        name: 'Dictator Test Platform',
        description: 'Testing platform for Dictator Game simulation',
        base_policies: {
          response_speed: 'Moderate',
          safe_harbor: 'Yes',
          payout_speed: 'Immediate',
          overall_transparency: 'High',
          offer_multiplier: '1.0',
        },
      });
    }

    const companies = [
      {
        name: 'CVE Secure',
        description: 'Offers balanced cash + recognition trade-offs.',
        platform_id: platform._id,
        variants: [],
        bounty_tiers: [],
      },
      {
        name: 'MoneyMax',
        description: 'Focuses on monetary payouts over recognition.',
        platform_id: platform._id,
        variants: [],
        bounty_tiers: [],
      },
    ];

    for (const data of companies) {
      const exists = await Company.findOne({ name: data.name });
      if (!exists) await Company.create(data);
    }

    console.log('Dictator Game platform & companies generated');
  } catch (err) {
    console.error(err);
  } finally {
    mongoose.connection.close();
  }
}

generateDictatorPlatform();
