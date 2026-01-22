// bot/utils/setupCompaniesEnhanced.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const Platform = require('../../models/Platform');
const Vulnerabilities = require('../../models/Vulnerabilities');
const Reports = require('../../models/Reports');
const CompanyOffers = require('../../models/CompanyOffers');
const Trades = require('../../models/Trades');
const Expoits = require('../../models/Exploit')
const Rounds = require('../../models/Rounds')
async function setup() {
    //TODO: connect AI  agent jose sent and modify it for context of new severity information
    //TODO: have agent push to google sheets first then push the mongodb
    //prob need to add in rounds to call the agent to generate more vol when needed
    //TODO: (if possible) have so if we make changfes in the sheets the fields in mongodb are also updated
    //TODO: Lets start giving comanies and the platforms more create names :)

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB connected');

        // Clear all collections
        console.log('Clearing existing data...');
        await clearCollections();
        
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

        // Create companies
        const companies = [];
        for (const config of companyConfigs) {
            const company = await Company.create({
                name: config.name,
                description: config.description,
                platform_id: config.platform,
                product_type: config.product_type,
                preferred_vulns: config.preferred_vulns,
                reputation_tiers: config.reputation_tiers,
                variants: [],
                bounty_tiers: []
            });
            companies.push(company);
            console.log(`✓ Created ${config.name}`);
        }



        console.log('\n Data load completed successfully!');
        console.log(` Created ${companies.length} companies with vulnerabilities`);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        mongoose.connection.close();
    }
}

// Function to clear all collections
async function clearCollections() {
    try {
        await Company.deleteMany({});
        console.log(' Cleared Company collection');
        
        await Volunerabilies.deleteMany({});
        console.log(' Cleared Volunerabilies collection');
        
        await Reports.deleteMany({});
        console.log(' Cleared Reports collection');
        
        await CompanyOffers.deleteMany({});
        console.log('Cleared CompanyOffers collection');
        
        await Trades.deleteMany({});
        console.log(' Cleared Trades collection');
        
        await Expoits.deleteMany({});
        console.log(' Cleared Exploits collection');

        await Rounds.deleteMany({});
        console.log(' Cleared Rounds collection');


        console.log('All collections cleared successfully\n');
    } catch (error) {
        console.error('Error clearing collections:', error);
        throw error;
    }
}


setup();