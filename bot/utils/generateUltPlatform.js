require('dotenv').config();
const mongoose = require('mongoose');
const Platform = require('../../models/Platform');
const Company = require('../../models/Company');

async function generateUltPlatform() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB connected');

        // Upsert platform (create or update)
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

        console.log(`✅ Platform ready: ${platform.name}`);

        // Companies for this platform
        const companies = [
            {
                name: 'FairCorp',
                description: 'High transparency, fair offers.',
            },
            {
                name: 'Lowball Inc',
                description: 'Low transparency, unfair offers.',
            },
            {
                name: 'ReputationX',
                description: 'Offers mix of money and reputation.',
            },
        ];

        // Generate or update each company
        for (const data of companies) {
            const updated = await Company.findOneAndUpdate(
                { name: data.name },
                {
                    $set: {
                        description: data.description,
                        platform_id: platform._id,
                        variants: [],
                        bounty_tiers: [],
                    },
                },
                { new: true, upsert: true }
            );

            console.log(`🏢 Company ready: ${updated.name}`);
        }

        console.log('Ultimatum Test Platform setup complete.');
    } catch (err) {
        console.error('Error generating Ultimatum Platform:', err);
    } finally {
        await mongoose.disconnect();
        console.log('MongoDB disconnected');
    }
}

generateUltPlatform();
