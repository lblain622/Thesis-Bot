// bot/utils/loadData.js
require('dotenv').config({path: require('path').resolve(__dirname, '../../.env')});
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const Platform = require('../../models/Platform');
const Vulnerabilities = require('../../models/Vulnerabilities');
const Reports = require('../../models/Reports');
const CompanyOffers = require('../../models/CompanyOffers');
const Trades = require('../../models/Trades');
const Expoits = require('../../models/Exploit');
const Rounds = require('../../models/Round');
const Users = require('../../models/Users');
const Items = require('../../models/Items');
const ItemStock = require('../../models/ItemStock');
const ShopRotation = require('../../models/ShopRotation');
const PlayerChoices = require('../../models/PlayerChoices');
const {loadShopItems} = require('./loadShopItems');
const testVulnData = require('../../data/test-data.json');

// Seed companies and related data assuming an active DB connection exists
async function loadInitialData() {
    try {
        // Find or create platforms
        let ultimatumPlatform = await Platform.findOne({name: 'Ultimatum Test Platform'});
        if (!ultimatumPlatform) {
            ultimatumPlatform = await Platform.create({
                name: 'Ultimatum Test Platform',
                description: 'A platform focused on fair trade and transparency.',
                base_policies: {
                    response_speed: 'Fast',
                    safe_harbor: 'Full',
                    payout_speed: 'Instant',
                    overall_transparency: 'High',
                    offer_multiplier: '1.2'
                }
            });
            console.log('✓ Created Ultimatum Test Platform');
        }

        let dictatorPlatform = await Platform.findOne({name: 'Dictator Test Platform'});
        if (!dictatorPlatform) {
            dictatorPlatform = await Platform.create({
                name: 'Dictator Test Platform',
                description: 'A platform with strict rules and variable rewards.',
                base_policies: {
                    response_speed: 'Variable',
                    safe_harbor: 'Partial',
                    payout_speed: 'Standard',
                    overall_transparency: 'Low',
                    offer_multiplier: '1.0'
                }
            });
            console.log('✓ Created Dictator Test Platform');
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
            // Check if company already exists
            let company = await Company.findOne({name: config.name});
            if (!company) {
                company = await Company.create({
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
            } else {
                console.log(`✓ Found existing ${config.name}`);
            }
            companies.push(company);
        }

        // ----- FIX: Properly generate vulnerabilities matching schema -----
        // Seed 15 global vulnerabilities (unassigned) – discovered later via /search
        const inOneWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Use test data if available, otherwise fallback to generated
        const vulnDataSource = testVulnData && testVulnData.length ? testVulnData : generateFallbackVulnData();

        const vulnsPayload = [];

        for (let i = 0; i < 15; i++) {
            const company = companies[Math.floor(Math.random() * companies.length)];
            const data = vulnDataSource[Math.floor(Math.random() * vulnDataSource.length)];

            // Generate unique identifier
            const vulnType = data.volun_type || data.type || ['XSS', 'SQLi', 'CSRF', 'RCE', 'IDOR'][Math.floor(Math.random() * 5)];
            const companyCode = company.name?.toUpperCase()?.replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'COMP';
            const uniqueId = `${Date.now().toString().slice(-4)}${i}`;
            const vulnIdentifier = `${vulnType}-${companyCode}-${uniqueId}`;


            const isGlobal = false

            // Helper function to get answer
            function getAnswer(val) {
                if (val == null) return undefined;
                if (typeof val === 'string') return val;
                if (typeof val === 'object' && typeof val.answer === 'string') return val.answer;
                return undefined;
            }

            // Create vulnerability with proper schema structure
            vulnsPayload.push({
                company_id: company._id,
                round_id: null,
                vuln_identifier: vulnIdentifier,
                volun_type: vulnType,
                severity: data.severity || ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
                name: `${vulnType} vulnerability in ${company.name}`,
                description: data.description || `A ${data.severity || 'security'} issue was discovered in ${company.name}.`,

                // Field objects with answer AND visibleTo arrays
                networkAccess: {
                    answer: getAnswer(data.networkAccess),
                    visibleTo: []
                },
                arbitraryCodeExecution: {
                    answer: getAnswer(data.arbitraryCodeExecution),
                    visibleTo: []
                },
                userInteraction: {
                    answer: getAnswer(data.userInteraction) || 'No',
                    visibleTo: []
                },
                automatable: {
                    answer: getAnswer(data.automatable),
                    visibleTo: []
                },
                confidentialityImpact: {
                    answer: getAnswer(data.confidentialityImpact),
                    visibleTo: []
                },
                integrityImpact: {
                    answer: getAnswer(data.integrityImpact),
                    visibleTo: []
                },
                availabilityImpact: {
                    answer: getAnswer(data.availabilityImpact),
                    visibleTo: []
                },
                privilegesRequired: {
                    answer: getAnswer(data.privilegesRequired),
                    visibleTo: []
                },
                recoveryPotential: {
                    answer: getAnswer(data.recoveryPotential) || 'Unknown',
                    visibleTo: []
                },

                // Report status
                isReported: false,
                isResolved: false,
                reported_date: null,
                is_resolved_date: null,
                expiration_date: inOneWeek(),

                // Visibility settings
                visibility: {
                    isGlobal: isGlobal,
                    allowedUsers: []
                },

                // Arrays
                pocs_submitted: [],
                reported_by: [],
                discovered_by: [],

                // Auto-offer helpers
                offer_wait_started_at: null,
                last_offer_report_id: null
            });
        }

        if (vulnsPayload.length) {
            // Check for existing vulnerabilities to avoid duplicates
            for (const vuln of vulnsPayload) {
                const exists = await Vulnerabilities.findOne({vuln_identifier: vuln.vuln_identifier});
                if (!exists) {
                    await Vulnerabilities.create(vuln);
                }
            }
            console.log(`✓ Seeded ${vulnsPayload.length} unassigned vulnerabilities`);
        }

        // Load/refresh shop catalog items
        let shopResult = {count: 0, error: false};
        try {
            shopResult = await loadShopItems();
        } catch (error) {
            console.error('Error loading shop items:', error);
            shopResult = {count: 0, error: true};
        }

        console.log('\n✅ Data load completed successfully!');
        console.log(`   Created/Found ${companies.length} companies`);
        console.log(`   Seeded ${vulnsPayload.length} vulnerabilities`);
        console.log(`   Shop items loaded: ${shopResult?.count || 0}`);

        return {
            companiesCreated: companies.length,
            vulnerabilitiesSeeded: vulnsPayload.length,
            shopItemsLoaded: shopResult?.count || 0
        };
    } catch (err) {
        console.error('❌ Error in loadInitialData:', err);
        throw err;
    }
}

// Fallback vulnerability data generator if test-data.json is missing
function generateFallbackVulnData() {
    return [
        {
            volun_type: 'XSS',
            severity: 'MEDIUM',
            description: 'A cross-site scripting vulnerability allows injection of malicious scripts.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'Yes',
            automatable: 'No',
            confidentialityImpact: 'Low',
            integrityImpact: 'Low',
            availabilityImpact: 'None',
            privilegesRequired: 'None',
            recoveryPotential: 'User'
        },
        {
            volun_type: 'SQLi',
            severity: 'HIGH',
            description: 'SQL injection vulnerability allows reading of database contents.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'High',
            integrityImpact: 'Low',
            availabilityImpact: 'None',
            privilegesRequired: 'None',
            recoveryPotential: 'User'
        },
        {
            volun_type: 'CSRF',
            severity: 'MEDIUM',
            description: 'Cross-site request forgery allows state-changing actions.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'Yes',
            automatable: 'Yes',
            confidentialityImpact: 'Low',
            integrityImpact: 'Medium',
            availabilityImpact: 'None',
            privilegesRequired: 'None',
            recoveryPotential: 'User'
        },
        {
            volun_type: 'RCE',
            severity: 'CRITICAL',
            description: 'Remote code execution allows complete system compromise.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'Yes',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'High',
            integrityImpact: 'High',
            availabilityImpact: 'High',
            privilegesRequired: 'None',
            recoveryPotential: 'Irrecoverable'
        },
        {
            volun_type: 'IDOR',
            severity: 'MEDIUM',
            description: 'Insecure direct object reference allows access to unauthorized data.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'Medium',
            integrityImpact: 'None',
            availabilityImpact: 'None',
            privilegesRequired: 'Low',
            recoveryPotential: 'User'
        },
        {
            volun_type: 'Authentication',
            severity: 'HIGH',
            description: 'Authentication bypass allows unauthorized access.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'High',
            integrityImpact: 'High',
            availabilityImpact: 'Low',
            privilegesRequired: 'None',
            recoveryPotential: 'User'
        },
        {
            volun_type: 'Cryptographic',
            severity: 'MEDIUM',
            description: 'Weak cryptographic implementation exposes sensitive data.',
            networkAccess: 'No',
            arbitraryCodeExecution: 'No',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'High',
            integrityImpact: 'Low',
            availabilityImpact: 'None',
            privilegesRequired: 'Low',
            recoveryPotential: 'Automatic'
        },
        {
            volun_type: 'Information_Disclosure',
            severity: 'LOW',
            description: 'Sensitive information is exposed to unauthorized parties.',
            networkAccess: 'Yes',
            arbitraryCodeExecution: 'No',
            userInteraction: 'No',
            automatable: 'Yes',
            confidentialityImpact: 'Low',
            integrityImpact: 'None',
            availabilityImpact: 'None',
            privilegesRequired: 'None',
            recoveryPotential: 'Automatic'
        }
    ];
}

// Function to clear all collections
async function clearCollections() {
    try {
        await Users.deleteMany({});
        console.log('✓ Cleared Users collection');

        await Platform.deleteMany({});
        console.log('✓ Cleared Platform collection');

        await Items.deleteMany({});
        console.log('✓ Cleared Items collection');

        await ItemStock.deleteMany({});
        console.log('✓ Cleared ItemStock collection');

        await ShopRotation.deleteMany({});
        console.log('✓ Cleared ShopRotation collection');

        await PlayerChoices.deleteMany({});
        console.log('✓ Cleared PlayerChoices collection');

        await Company.deleteMany({});
        console.log('✓ Cleared Company collection');

        await Vulnerabilities.deleteMany({});
        console.log('✓ Cleared Vulnerabilities collection');

        await Reports.deleteMany({});
        console.log('✓ Cleared Reports collection');

        await CompanyOffers.deleteMany({});
        console.log('✓ Cleared CompanyOffers collection');

        await Trades.deleteMany({});
        console.log('✓ Cleared Trades collection');

        await Expoits.deleteMany({});
        console.log('✓ Cleared Exploits collection');

        await Rounds.deleteMany({});
        console.log('✓ Cleared Rounds collection');

        console.log('\n✅ All collections cleared successfully\n');
    } catch (error) {
        console.error('❌ Error clearing collections:', error);
        throw error;
    }
}

// Standalone script entry point (connects/closes DB)
async function setup() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ MongoDB connected');

        console.log('\n🗑️  Clearing existing data...');
        await clearCollections();

        console.log('\n🌱 Loading initial data...');
        await loadInitialData();

        console.log('\n🎉 Setup completed successfully!');
    } catch (err) {
        console.error('❌ Setup error:', err);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed');
    }
}

if (require.main === module) {
    setup();
}

module.exports = {
    clearCollections,
    loadInitialData,
};