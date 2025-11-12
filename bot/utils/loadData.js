// bot/utils/setupCompaniesEnhanced.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const Platform = require('../../models/Platform');
//Setup
async function setup() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        // Find or create platforms
        let ultimatumPlatform = await Platform.findOne({ name: 'Ultimatum Test Platform' });
        let dictatorPlatform = await Platform.findOne({ name: 'Dictator Test Platform' });

        if (!ultimatumPlatform || !dictatorPlatform) {
            console.log('Please run generateUltPlatform.js and generateDicPlatform.js first');
            process.exit(1);
        }

        // Enhanced company configurations
        const companyConfigs = [
            // Ultimatum Platform Companies
            {
                platform: ultimatumPlatform._id,
                name: 'FairCorp',
                description: 'High transparency, fair offers. Focuses on web applications.',
                product_type: 'web_app',
                preferred_vulns: ['XSS', 'CSRF', 'Authentication'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 50,
                        bonus_multiplier: 1.0,
                        special_perks: ['Standard response times']
                    },
                    {
                        min_reputation: 51,
                        max_reputation: 100,
                        bonus_multiplier: 1.15,
                        special_perks: ['15% bonus on all reports', 'Priority review']
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 200,
                        bonus_multiplier: 1.25,
                        special_perks: ['25% bonus on all reports', 'Fast-track resolution', 'Private program access']
                    },
                    {
                        min_reputation: 201,
                        max_reputation: 999999,
                        bonus_multiplier: 1.5,
                        special_perks: ['50% bonus on all reports', 'Direct contact with security team', 'Exclusive bounties']
                    }
                ]
            },
            {
                platform: ultimatumPlatform._id,
                name: 'Lowball Inc',
                description: 'Low transparency, unfair offers. Mobile app security focus.',
                product_type: 'mobile_app',
                preferred_vulns: ['IDOR', 'Business_Logic'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0,
                        special_perks: ['Standard processing']
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 999999,
                        bonus_multiplier: 1.1,
                        special_perks: ['10% bonus', 'Slightly faster response']
                    }
                ]
            },
            {
                platform: ultimatumPlatform._id,
                name: 'ReputationX',
                description: 'Offers mix of money and reputation. API security specialists.',
                product_type: 'api',
                preferred_vulns: ['Authentication', 'Authorization', 'Information_Disclosure'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 75,
                        bonus_multiplier: 1.0,
                        special_perks: ['Standard rewards']
                    },
                    {
                        min_reputation: 76,
                        max_reputation: 150,
                        bonus_multiplier: 1.2,
                        special_perks: ['20% bonus', 'Reputation boost']
                    },
                    {
                        min_reputation: 151,
                        max_reputation: 999999,
                        bonus_multiplier: 1.35,
                        special_perks: ['35% bonus', 'Hall of Fame entry', 'Swag rewards']
                    }
                ]
            },

            // Dictator Platform Companies
            {
                platform: dictatorPlatform._id,
                name: 'CVE Secure',
                description: 'Balanced cash + recognition. Infrastructure security.',
                product_type: 'infrastructure',
                preferred_vulns: ['RCE', 'SQLi', 'Cryptographic'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0,
                        special_perks: ['Standard options']
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 999999,
                        bonus_multiplier: 1.15,
                        special_perks: ['15% bonus on all options']
                    }
                ]
            },
            {
                platform: dictatorPlatform._id,
                name: 'MoneyMax',
                description: 'Monetary payouts over recognition. IoT security.',
                product_type: 'iot',
                preferred_vulns: ['RCE', 'Authentication', 'Other'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 50,
                        bonus_multiplier: 1.0,
                        special_perks: ['Cash-focused rewards']
                    },
                    {
                        min_reputation: 51,
                        max_reputation: 999999,
                        bonus_multiplier: 1.25,
                        special_perks: ['25% cash bonus', 'Expedited payment']
                    }
                ]
            },

            // Additional specialized companies
            {
                platform: ultimatumPlatform._id,
                name: 'BlockChainSafe',
                description: 'Blockchain and crypto security specialists.',
                product_type: 'blockchain',
                preferred_vulns: ['Cryptographic', 'Business_Logic', 'RCE'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0,
                        special_perks: ['Standard rewards']
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 200,
                        bonus_multiplier: 1.3,
                        special_perks: ['30% bonus', 'Crypto payment options']
                    },
                    {
                        min_reputation: 201,
                        max_reputation: 999999,
                        bonus_multiplier: 1.6,
                        special_perks: ['60% bonus', 'Token rewards', 'Early access to new products']
                    }
                ]
            },
            {
                platform: dictatorPlatform._id,
                name: 'AI SecurityLab',
                description: 'AI/ML security research and testing.',
                product_type: 'ai_ml',
                preferred_vulns: ['Business_Logic', 'Information_Disclosure', 'Other'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 150,
                        bonus_multiplier: 1.0,
                        special_perks: ['Research collaboration opportunities']
                    },
                    {
                        min_reputation: 151,
                        max_reputation: 999999,
                        bonus_multiplier: 1.4,
                        special_perks: ['40% bonus', 'Co-authorship on papers', 'Conference invitations']
                    }
                ]
            }
        ];

        // Update or create companies
        for (const config of companyConfigs) {
            const existing = await Company.findOne({
                name: config.name,
                platform_id: config.platform
            });

            if (existing) {
                await Company.updateOne(
                    { _id: existing._id },
                    {
                        $set: {
                            product_type: config.product_type,
                            preferred_vulns: config.preferred_vulns,
                            reputation_tiers: config.reputation_tiers,
                            description: config.description
                        }
                    }
                );
                console.log(`✓ Updated ${config.name}`);
            } else {
                await Company.create({
                    name: config.name,
                    description: config.description,
                    platform_id: config.platform,
                    product_type: config.product_type,
                    preferred_vulns: config.preferred_vulns,
                    reputation_tiers: config.reputation_tiers,
                    variants: [],
                    bounty_tiers: []
                });
                console.log(`✓ Created ${config.name}`);
            }
        }


    } catch (err) {
        console.error('Error:', err);
    } finally {
        mongoose.connection.close();
    }
}

setup();