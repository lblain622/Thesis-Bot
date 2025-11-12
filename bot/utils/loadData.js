// bot/utils/setupCompaniesEnhanced.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const Platform = require('../../models/Platform');
const Volunerabilies = require('../../models/Volunerabilies'); // Add this import

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
        const companies = [];
        for (const config of companyConfigs) {
            const existing = await Company.findOne({
                name: config.name,
                platform_id: config.platform
            });

            let company;
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
                company = existing;
                console.log(`✓ Updated ${config.name}`);
            } else {
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
            }
            companies.push(company);
        }

        // Add vulnerabilities for each company
        console.log('\nAdding vulnerabilities...');
        await addVulnerabilities(companies);

    } catch (err) {
        console.error('Error:', err);
    } finally {
        mongoose.connection.close();
    }
}

// Function to add vulnerabilities without user-related fields
async function addVulnerabilities(companies) {
    try {
        // Clear existing vulnerabilities
        await Volunerabilies.deleteMany({});
        console.log('Cleared existing vulnerabilities');

        const vulnerabilities = [];

        companies.forEach((company, index) => {
            const companyVulns = [
                {
                    company_id: company._id,
                    vuln_identifier: `VULN-${company.name.toUpperCase().replace(/\s+/g, '')}-001`,
                    volun_type: company.preferred_vulns[0] || 'XSS',
                    name: `${company.preferred_vulns[0] || 'XSS'} Vulnerability in ${company.product_type}`,
                    description: `Critical ${company.preferred_vulns[0] || 'XSS'} vulnerability discovered in ${company.name}'s ${company.product_type} system.`,
                    cvss_score: 8.5 + (index * 0.2),
                    cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
                    severity: 'Critical',
                    isReported: true,
                    isResolved: false,
                    reported_date: new Date(),
                    expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    visibility: {
                        isGlobal: true,
                        allowedUsers: []
                    }
                },
                {
                    company_id: company._id,
                    vuln_identifier: `VULN-${company.name.toUpperCase().replace(/\s+/g, '')}-002`,
                    volun_type: company.preferred_vulns[1] || 'SQLi',
                    name: `${company.preferred_vulns[1] || 'SQLi'} Security Flaw`,
                    description: ` ${company.preferred_vulns[1] || 'SQLi'} vulnerability affecting ${company.name}'s services.`,
                    cvss_score: 6.2 + (index * 0.1),
                    cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N',
                    severity: 'Medium',
                    isReported: true,
                    isResolved: true,
                    is_resolved_date: new Date(),
                    reported_date: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
                    expiration_date: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
                    visibility: {
                        isGlobal: false,
                        allowedUsers: []
                    }
                },
                {
                    company_id: company._id,
                    vuln_identifier: `VULN-${company.name.toUpperCase().replace(/\s+/g, '')}-003`,
                    volun_type: company.preferred_vulns[2] || 'CSRF',
                    name: `${company.preferred_vulns[2] || 'CSRF'} Protection Bypass`,
                    description: ` ${company.preferred_vulns[2] || 'CSRF'} issue requiring user interaction.`,
                    cvss_score: 4.5 + (index * 0.1),
                    cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N',
                    severity: 'Low',
                    isReported: false,
                    isResolved: false,
                    reported_date: new Date(),
                    expiration_date: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
                    visibility: {
                        isGlobal: true,
                        allowedUsers: []
                    }
                }
            ];

            vulnerabilities.push(...companyVulns);
        });

        // Insert all vulnerabilities
        const result = await Volunerabilies.insertMany(vulnerabilities);
        console.log(`✓ Successfully added ${result.length} vulnerabilities across ${companies.length} companies`);

        // Log summary
        companies.forEach(company => {
            const companyVulns = vulnerabilities.filter(v => v.company_id.equals(company._id));
            console.log(`  - ${company.name}: ${companyVulns.length} vulnerabilities`);
        });

    } catch (error) {
        console.error('Error adding vulnerabilities:', error);
        throw error;
    }
}

setup();