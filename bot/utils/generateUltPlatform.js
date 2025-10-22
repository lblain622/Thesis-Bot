const mongoose = require('mongoose');
const Platform = require('../models/Platform');
const Company = require('../models/Company');

async function generateUltPlatform() {
    try{
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        let platform = await Platform.findOne({name:'Ultimatum Test Platform'})
        if(!platform) {
            platform = await Platform.create({
                name: 'Ultimatum Test Platform',
                description: 'Ultimatum Test Platform',
                base_policies:{
                    response_speed: 'Fast',
                    safe_harbor: 'Yes',
                    payout_speed: 'Immediate',
                    overall_transparency: 'Variable',
                    offer_multiplier: '1.0'
                }
        })
        }
        console.log('Created Platform');
        const companies = [
            {
                name: 'FairCorp',
                description: 'High transparency, fair offers.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: [],
            },
            {
                name: 'Lowball Inc',
                description: 'Low transparency, unfair offers.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: [],
            },
            {
                name: 'ReputationX',
                description: 'Offers mix of money and reputation.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: [],
            },
        ];

        for (const data of companies) {
            const exists = await Company.findOne({ name: data.name });
            if (!exists) {
                await Company.create(data);
            }
        }

    }catch(err){
        console.error(err);
    }
}