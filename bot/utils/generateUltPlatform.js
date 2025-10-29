require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');
const BountyTier = require('../../models/BountyTiers');
const CompanyOffer = require('../../models/CompanyOffers');

async function generateUltPlatform() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');


        const platformData = {
            name: 'Ultimatum Test Platform',
            description: 'A test platform for the Ultimatum Game simulation.',
            base_policies: {
                response_speed: 'Fast',
                safe_harbor: 'Yes',
                payout_speed: 'Immediate',
                overall_transparency: 'Variable',
                offer_multiplier: '1.0',
            },
        };

        const platform = await Platform.findOneAndUpdate(
            { name: platformData.name },
            { $set: platformData },
            { new: true, upsert: true }
        );
        console.log(` Platform ready: ${platform.name}`);


        const tiers = [
            { severity: 'Low', min_value: '50', max_value: '150', description: 'Minor issues' },
            { severity: 'Medium', min_value: '150', max_value: '400', description: 'Moderate issues' },
            { severity: 'High', min_value: '400', max_value: '700', description: 'Severe issues' },
            { severity: 'Critical', min_value: '700', max_value: '1200', description: 'Extremely severe issues' },
        ];


        for (const t of tiers) {
            await BountyTier.findOneAndUpdate(
                { severity: t.severity },
                { $set: t },
                { new: true, upsert: true }
            );
        }

        // Companies
        const companies = [
            {
                name: 'FairCorp',
                description: 'High transparency, fair offers.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: tiers.map(t => t._id), // link bounty tiers
            },
            {
                name: 'Lowball Inc',
                description: 'Low transparency, unfair offers.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: tiers.map(t => t._id),
            },
            {
                name: 'ReputationX',
                description: 'Mix of money and reputation points.',
                platform_id: platform._id,
                variants: [],
                bounty_tiers: tiers.map(t => t._id),
            },
        ];

        for (const data of companies) {
            await Company.findOneAndUpdate(
                { name: data.name },
                { $set: data },
                { new: true, upsert: true }
            );
        }

        // Example CompanyOffer template (counter_offer included)
        const exampleOffer = {
            company_id: companies[0]._id, // just for seeding
            report_id: null,
            user_id: null,
            original_amount: 500,
            offered_amount: 500,
            offer_percent: 100,
            reputation_offered: '10 points',
            status: 'pending',
            expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week
            created_at: new Date(),
            resolved_at: null,
            counter_offer: null,
        };

        console.log(' Ultimatum Test Platform setup complete.');
    } catch (err) {
        console.error('Error generating Ultimatum Platform:', err);
    } finally {
        await mongoose.disconnect();
        console.log(' MongoDB disconnected');
    }
}

generateUltPlatform();
