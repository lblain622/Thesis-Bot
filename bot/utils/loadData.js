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
const vulnSeedData = require('../../data/voln-data.json');
const fs = require('fs');
const path = require('path');


function loadWordList(filename, key) {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(__dirname, filename), 'utf8'));
        return key ? data[key] : data;
    } catch (error) {
        console.error(`Error loading ${filename}:`, error.message);
        return [];
    }
}

const VULN_TYPE_MAP = {
    SQLi: 'SQL_Injection',
    XSS: 'Cross_Site_Scripting',
    RCE: 'Remote_Code_Execution',
    Authentication: 'Authentication_Bypass',
    Authorization: 'Privilege_Escalation',
    Other: 'Other'
};

function normalizeVulnType(value) {
    const sanitized = String(value || 'Other')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return VULN_TYPE_MAP[sanitized] || sanitized || 'Other';
}

function normalizeSeverity(value) {
    const severity = String(value || '').toUpperCase();
    return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(severity) ? severity : 'LOW';
}

function normalizeRecoveryPotential(value) {
    const recovery = String(value || '').trim();
    if (['Automatic', 'User', 'Irrecoverable', 'Unknown'].includes(recovery)) return recovery;
    if (recovery === 'Manual') return 'User';
    return 'Unknown';
}

function getSourceIdentifier(data, fallbackIndex) {
    return data.id || data.cve_id || data.vuln_identifier || data.vulnerability_id || `seed-${fallbackIndex}`;
}

function dedupeVulnData(source) {
    const seen = new Set();
    return source.filter((data, index) => {
        const key = getSourceIdentifier(data, index) || `${data.volun_type || data.vuln_type}:${data.description}`;
        const normalizedKey = String(key).trim().toLowerCase();
        if (seen.has(normalizedKey)) return false;
        seen.add(normalizedKey);
        return true;
    });
}

function slugifyIdentifier(value) {
    return String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function randomWord(words, fallback) {
    return words.length ? words[Math.floor(Math.random() * words.length)] : fallback;
}

function generateRandomVulnIdentifier(adjList, nounList, usedIdentifiers, index) {
    let attempts = 0;
    let vulnIdentifier;
    const maxAttempts = 25;

    do {
        const adj = slugifyIdentifier(randomWord(adjList, 'Unknown'));
        const noun = slugifyIdentifier(randomWord(nounList, 'Vulnerability'));
        vulnIdentifier = `${adj}-${noun}`;
        attempts++;
    } while (usedIdentifiers.has(vulnIdentifier) && attempts < maxAttempts);

    if (usedIdentifiers.has(vulnIdentifier)) {
        vulnIdentifier = `${vulnIdentifier}-${index}`;
    }

    return vulnIdentifier;
}

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
                name: 'BugBunny Labs',
                description: 'BugBunny Labs delivers enterprise-grade web application security testing with data-driven payout policies and transparent reporting.',
                product_type: 'web_app',
                preferred_vulns: ['Cross_Site_Scripting', 'Open_Redirect', 'Authentication_Bypass'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 50,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 51,
                        max_reputation: 100,
                        bonus_multiplier: 1.15
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 200,
                        bonus_multiplier: 1.25
                    },
                    {
                        min_reputation: 201,
                        max_reputation: 999999,
                        bonus_multiplier: 1.5
                    }
                ]
            },
            {
                platform: ultimatumPlatform._id,
                name: 'PocketRaiders',
                description: '💰 PocketRaiders rewards mobile security heroes with cold, hard cash! Higher impact means bigger payouts - we pay what your findings are worth!',
                product_type: 'mobile_app',
                preferred_vulns: ['Path_Traversal', 'Race_Condition'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 999999,
                        bonus_multiplier: 1.1
                    }
                ]
            },
            {
                platform: ultimatumPlatform._id,
                name: 'HackHeroes',
                description: '🏆 HackHeroes honors elite researchers with premium bounties and exclusive credit bonuses! Prove your skills and earn the recognition you deserve!',
                product_type: 'api',
                preferred_vulns: ['Authentication_Bypass', 'Privilege_Escalation', 'Information_Disclosure'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 75,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 76,
                        max_reputation: 150,
                        bonus_multiplier: 1.2
                    },
                    {
                        min_reputation: 151,
                        max_reputation: 999999,
                        bonus_multiplier: 1.35
                    }
                ]
            },

            // Dictator Platform Companies
            {
                platform: dictatorPlatform._id,
                name: 'ZeroDay Zen',
                description: '☁️ ZeroDay Zen delivers instant cash rewards for cloud warriors! Lightning-fast payouts and escalating bonuses for persistent researchers!',
                product_type: 'infrastructure',
                preferred_vulns: ['Remote_Code_Execution', 'SQL_Injection', 'Command_Injection'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 999999,
                        bonus_multiplier: 1.15
                    }
                ]
            },
            {
                platform: dictatorPlatform._id,
                name: 'CryptoWarden',
                description: '🔌 CryptoWarden showers IoT innovators with generous cash flows! Smart device security pays off big - get rewarded for keeping the connected world safe!',
                product_type: 'iot',
                preferred_vulns: ['Buffer_Overflow', 'Authentication_Bypass', 'XML_External_Entity'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 50,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 51,
                        max_reputation: 999999,
                        bonus_multiplier: 1.25
                    }
                ]
            },

            // Additional specialized companies
            {
                platform: ultimatumPlatform._id,
                name: 'BlockShield',
                description: '⛓️ BlockShield makes blockchain bounty hunters rich! Massive payouts for crypto-critical finds - your wallet will thank you!',
                product_type: 'blockchain',
                preferred_vulns: ['SSRF', 'XML_External_Entity', 'Remote_Code_Execution'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 100,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 101,
                        max_reputation: 200,
                        bonus_multiplier: 1.3
                    },
                    {
                        min_reputation: 201,
                        max_reputation: 999999,
                        bonus_multiplier: 1.6
                    }
                ]
            },
            {
                platform: dictatorPlatform._id,
                name: 'NeuralNightmare',
                description: '🧠 NeuralNightmare fuels AI researchers with explosive cash rewards! Unlock the secrets of machine learning and get paid handsomely for your discoveries!',
                product_type: 'ai_ml',
                reputation_threshold: 100,
                preferred_vulns: ['Race_Condition', 'Information_Disclosure', 'Insecure_Deserialization'],
                reputation_tiers: [
                    {
                        min_reputation: 0,
                        max_reputation: 150,
                        bonus_multiplier: 1.0
                    },
                    {
                        min_reputation: 151,
                        max_reputation: 999999,
                        bonus_multiplier: 1.4
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
                    reputation_threshold: config.reputation_threshold || 0,
                    variants: [],
                    bounty_tiers: []
                });
                console.log(`✓ Created ${config.name}`);
            } else {
                console.log(`✓ Found existing ${config.name}`);
            }
            companies.push(company);
        }

        // Seed 15 global vulnerabilities (unassigned) – discovered later via /search
        const inSessionWindow = () => new Date(Date.now() + 45 * 60 * 1000);

        // Use voln-data.json if available, otherwise fallback to generated data.
        const rawVulnDataSource = vulnSeedData && vulnSeedData.length ? vulnSeedData : generateFallbackVulnData();
        const vulnDataSource = dedupeVulnData(rawVulnDataSource);

        // Shuffle vulnerability data to ensure no duplicates when sampling
        const shuffledVulnData = [...vulnDataSource].sort(() => 0.5 - Math.random());
        
        const vulnsPayload = [];
        const nounList = loadWordList('../../data/nouns.json', 'nouns');
        const adjList = loadWordList('../../data/adjs.json', 'adjs');
        const usedIdentifiers = new Set(); // Track used vuln_identifiers to prevent duplicates

        for (let i = 0; i < Math.min(15, shuffledVulnData.length); i++) {
            const data = shuffledVulnData[i]; // Use shuffle+slice instead of random selection

            const vulnIdentifier = generateRandomVulnIdentifier(adjList, nounList, usedIdentifiers, i);
            
            if (usedIdentifiers.has(vulnIdentifier)) {
                console.warn(`⚠️  Could not generate unique identifier for vulnerability ${i}, skipping`);
                continue;
            }
            usedIdentifiers.add(vulnIdentifier);
            
            const vulnType = normalizeVulnType(data.volun_type || data.vuln_type || data.type);


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
                company_id: null,
                round_id: null,
                vuln_identifier: vulnIdentifier,
                volun_type: vulnType,
                severity: normalizeSeverity(data.severity),
                name: vulnIdentifier,
                description: data.description || 'A security issue was discovered.',
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
                    answer: normalizeRecoveryPotential(getAnswer(data.recoveryPotential)),
                    visibleTo: []
                },

                // Report status
                isReported: false,
                isResolved: false,
                reported_date: null,
                is_resolved_date: null,
                expiration_date: inSessionWindow(),

                // Visibility settings
                visibility: {
                    isGlobal: isGlobal,
                    allowedUsers: []
                },

                // Arrays
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

// Fallback vulnerability data generator if voln-data.json is missing
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
