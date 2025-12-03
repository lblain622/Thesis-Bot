const Vulnerability = require('../../models/Volunerabilies');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Report = require('../../models/Reports');
const Users = require('../../models/Users')
const { EmbedBuilder } = require('discord.js');

/**
 * Generate vulnerabilities with new field structure (for data loading)
 */
async function generateVulnerabilitiesForCompanies(companies, countPerCompany = 3) {
    try {
        const vulnerabilities = [];

        // Vulnerability types with weights
        const vulnTypes = [
            { type: 'XSS', weight: 0.3 },
            { type: 'SQLi', weight: 0.2 },
            { type: 'CSRF', weight: 0.15 },
            { type: 'IDOR', weight: 0.2 },
            { type: 'RCE', weight: 0.05 },
            { type: 'Authentication', weight: 0.1 }
        ];

        // Severity distribution
        const severities = [
            { severity: 'Low', weight: 0.4 },
            { severity: 'Medium', weight: 0.35 },
            { severity: 'High', weight: 0.2 },
            { severity: 'Critical', weight: 0.05 }
        ];

        const allUsers = await Users.find({});
        if (!allUsers.length) {
            throw new Error('No users found in database');
        }


        companies.forEach((company, companyIndex) => {
            for (let i = 0; i < countPerCompany; i++) {
                // Weighted random type selection
                const type = weightedRandom(vulnTypes);
                
                // Weighted random severity selection
                const severityConfig = weightedRandom(severities);
                
                // Determine visibility (80% global, 20% exclusive)
                const isGlobal = Math.random() < 0.8;

                const allowedUsers = selectAllowedUsers(allUsers, isGlobal);
                // Generate field data based on vulnerability type and severity
                const fieldData = generateFieldData(type.type, severityConfig.severity, company,allowedUsers);

                const vulnerability = {
                    company_id: company._id,
                    vuln_identifier: `VULN-${company.name.toUpperCase().replace(/\s+/g, '')}-${(i + 1).toString().padStart(3, '0')}`,
                    volun_type: type.type,
                    name: `${type.type} in ${company.name}`,
                    severity: severityConfig.severity,
                    description: generateVulnDescription(type.type, company.name, severityConfig.severity),
                    isReported: false,
                    isResolved: false,
                    reported_date: new Date(),
                    expiration_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
                    visibility: {
                        isGlobal: isGlobal,
                        allowedUsers: allowedUsers
                    },
                    // New Y/N question fields
                    networkAccess: fieldData.networkAccess,
                    arbitraryCodeExecution: fieldData.arbitraryCodeExecution,
                    userInteraction: fieldData.userInteraction,
                    automatable: fieldData.automatable,
                    privilegesRequired: fieldData.privilegesRequired,
                    confidentialityImpact: fieldData.confidentialityImpact,
                    integrityImpact: fieldData.integrityImpact,
                    availabilityImpact: fieldData.availabilityImpact,
                    recoveryPotential: fieldData.recoveryPotential
                };

                // Set resolved date if resolved
                if (vulnerability.isResolved) {
                    vulnerability.is_resolved_date = new Date(Date.now() - Math.random() * 15 * 24 * 60 * 60 * 1000);
                }

                vulnerabilities.push(vulnerability);
            }
        });

        return vulnerabilities;

    } catch (error) {
        console.error('Error generating vulnerabilities:', error);
        throw error;
    }
}

/**
 * Generate field data based on vulnerability type and severity
 */
async function generateFieldData(vulnType, severity, company,allowedUsers) {
    const fieldData = {};
    
    let allUsers = allowedUsers;

    // Function to randomly select 0-3 users for a field
    const getRandomUsers = () => {
        if (allUsers.length === 0) return [];
        const numUsers = Math.floor(Math.random() * 4); // 0-3 users
        const shuffled = [...allUsers].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, numUsers).map(u => u._id);
    };

    // Network Access - Most vulnerabilities are network accessible
    fieldData.networkAccess = {
        answer: Math.random() < 0.8 ? 'Yes' : 'No',
        visibleTo: getRandomUsers()
    };

    // Arbitrary Code Execution - Only for RCE and some high severity vulns
    fieldData.arbitraryCodeExecution = {
        answer: (vulnType === 'RCE' || (severity === 'Critical' && Math.random() < 0.3)) ? 'Yes' : 'No',
        visibleTo: getRandomUsers()
    };

    // User Interaction - CSRF and some XSS require user interaction
    fieldData.userInteraction = {
        answer: (vulnType === 'CSRF' || (vulnType === 'XSS' && Math.random() < 0.6)) ? 'Yes' : 'No',
        visibleTo: getRandomUsers()
    };

    // Automatable - Most can be automated except those requiring user interaction
    fieldData.automatable = {
        answer: fieldData.userInteraction.answer === 'Yes' ? 'No' : 'Yes',
        visibleTo: getRandomUsers()
    };

    // Privileges Required - Based on severity and type
    const privilegeOptions = ['None', 'Low', 'High'];
    const privilegeWeights = {
        'Critical': [0.1, 0.3, 0.6],
        'High': [0.2, 0.5, 0.3],
        'Medium': [0.4, 0.4, 0.2],
        'Low': [0.6, 0.3, 0.1]
    };
    fieldData.privilegesRequired = {
        answer: weightedRandomChoice(privilegeOptions, privilegeWeights[severity]),
        visibleTo: getRandomUsers()
    };

    // CIA Impacts - Based on severity
    const impactLevels = ['None', 'Low', 'Medium', 'High'];
    const impactWeights = {
        'Critical': [0.0, 0.0, 0.2, 0.8],
        'High': [0.0, 0.1, 0.4, 0.5],
        'Medium': [0.1, 0.3, 0.5, 0.1],
        'Low': [0.4, 0.4, 0.2, 0.0]
    };

    fieldData.confidentialityImpact = {
        answer: weightedRandomChoice(impactLevels, impactWeights[severity]),
        visibleTo: getRandomUsers()
    };

    fieldData.integrityImpact = {
        answer: weightedRandomChoice(impactLevels, impactWeights[severity]),
        visibleTo: getRandomUsers()
    };

    fieldData.availabilityImpact = {
        answer: weightedRandomChoice(impactLevels, impactWeights[severity]),
        visibleTo: getRandomUsers()
    };

    // Recovery Potential - Based on impact levels
    const recoveryOptions = ['Automatic', 'User', 'Irrecoverable'];
    let recoveryWeights;
    if (fieldData.availabilityImpact.answer === 'High') {
        recoveryWeights = [0.1, 0.3, 0.6];
    } else if (fieldData.availabilityImpact.answer === 'Medium') {
        recoveryWeights = [0.2, 0.5, 0.3];
    } else {
        recoveryWeights = [0.6, 0.3, 0.1];
    }

    fieldData.recoveryPotential = {
        answer: weightedRandomChoice(recoveryOptions, recoveryWeights),
        visibleTo: getRandomUsers()
    };

    return fieldData;
}


function selectAllowedUsers(allUsers, isGlobal) {
    if (isGlobal) {
        // For global vulnerabilities, all users can access basic info
        return allUsers.map(user => user._id);
    } else {
        // For exclusive vulnerabilities, select 1-3 users
        const userCount = Math.floor(Math.random() * 3) + 1;
        const shuffledUsers = [...allUsers].sort(() => 0.5 - Math.random());
        return shuffledUsers.slice(0, userCount).map(user => user._id);
    }
}

/**
 * Assign users to a specific field's visibleTo
 */
function assignUsersToField(allUsers, count) {
    // Ensure allUsers is an array
    if (!Array.isArray(allUsers)) {
        console.error('allUsers is not an array:', allUsers);
        return [];
    }

    if (allUsers.length === 0) {
        return [];
    }

    // Shuffle users and select the specified number
    const shuffledUsers = [...allUsers].sort(() => 0.5 - Math.random());
    const selectedCount = Math.min(count, allUsers.length);
    return shuffledUsers.slice(0, selectedCount);
}

/**
 * Generate daily vulnerabilities with user assignments
 */
async function generateDailyVulnerabilities() {
    try {
        // Get all companies
        const companies = await Company.find({});
        if (!companies.length) {
            throw new Error('No companies found in database');
        }

        // Get all users
        const allUsers = await Users.find({});
        if (!allUsers.length) {
            throw new Error('No users found in database');
        }

        // End previous active round if exists
        await endPreviousRound();

        // Get next round number
        const lastRound = await Round.findOne().sort({ round_number: -1 });
        const roundNumber = lastRound ? lastRound.round_number + 1 : 1;

        // Create new round
        const round = await Round.create({
            round_number: roundNumber,
            companies_involved: companies.map(c => c._id),
            users_involved: allUsers.map(u => u._id)
        });

        // Generate vulnerabilities with user assignments
        const vulnerabilities = await generateVulnerabilitiesForCompanies(companies, 2);

        // Insert vulnerabilities
        const createdVulns = await Vulnerability.insertMany(vulnerabilities);

        // Log user assignments for debugging
        createdVulns.forEach(vuln => {
            console.log(`Vulnerability ${vuln.vuln_identifier}:`);
            console.log(`  Global: ${vuln.visibility.isGlobal}`);
            console.log(`  Allowed Users: ${vuln.visibility.allowedUsers.length}`);

            const fieldKeys = ['networkAccess', 'arbitraryCodeExecution', 'userInteraction',
                             'automatable', 'privilegesRequired', 'confidentialityImpact',
                             'integrityImpact', 'availabilityImpact', 'recoveryPotential'];

            fieldKeys.forEach(key => {
                if (vuln[key] && vuln[key].visibleTo) {
                    console.log(`  ${key}: ${vuln[key].visibleTo.length} users can view`);
                }
            });
        });

        // Update round with vulnerability count
        await Round.findByIdAndUpdate(round._id, {
            vulnerabilities_generated: createdVulns.length
        });

        console.log(`Generated ${createdVulns.length} vulnerabilities for round ${roundNumber}`);
        return createdVulns;

    } catch (error) {
        console.error('Error generating daily vulnerabilities:', error);
        throw error;
    }
}


/**
 * End current round and show summary
 */
async function endRound(client, channelId) {
    try {
        const currentRound = await Round.findOne({ status: 'active' });
        if (!currentRound) {
            throw new Error('No active round found');
        }

        // Get round statistics
        const roundReports = await Report.find({
            created_at: { $gte: currentRound.start_date }
        });

        const roundVulns = await Vulnerability.find({
            round_id: currentRound._id
        });

        const resolvedVulns = roundVulns.filter(v => v.isResolved);
        const totalPayout = roundReports.reduce((sum, report) => sum + (report.offered_amount || 0), 0);

        // Update round with end data
        await Round.findByIdAndUpdate(currentRound._id, {
            end_date: new Date(),
            status: 'ended',
            reports_submitted: roundReports.length,
            total_payout: totalPayout
        });

        // Send summary embed
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            throw new Error('Announcement channel not found');
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏁 Day ${currentRound.round_number} Ended!`)
            .setColor('#FF6B6B')
            .setDescription('The round has concluded. Here are the results:')
            .addFields(
                { name: 'Duration', value: `${formatDuration(currentRound.start_date, new Date())}`, inline: true },
                { name: 'Vulnerabilities', value: `${roundVulns.length}`, inline: true },
                { name: 'Resolved', value: `${resolvedVulns.length}`, inline: true },
                { name: 'Reports Submitted', value: `${roundReports.length}`, inline: true },
                { name: 'Total Payout', value: `$${totalPayout}`, inline: true },
                { name: 'Companies', value: `${currentRound.companies_involved.length}`, inline: true }
            )
            .setFooter({ text: 'Next round starting soon...' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

        // Auto-start next round after 1 hour
        setTimeout(async () => {
            try {
                const nextRoundVulns = await generateDailyVulnerabilities();
                await announceNewRound(client, channelId, nextRoundVulns);
            } catch (error) {
                console.error('Error auto-starting next round:', error);
            }
        }, 60 * 60 * 1000); // 1 hour delay

        return {
            round: currentRound,
            stats: {
                vulnerabilities: roundVulns.length,
                resolved: resolvedVulns.length,
                reports: roundReports.length,
                payout: totalPayout
            }
        };

    } catch (error) {
        console.error('Error ending round:', error);
        throw error;
    }
}

/**
 * Announce new round
 */
async function announceNewRound(client, channelId, vulnerabilities) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            throw new Error('Announcement channel not found');
        }

        const currentRound = await Round.findOne({ status: 'active' });
        if (!currentRound) {
            throw new Error('No active round found');
        }

        const globalVulns = vulnerabilities.filter(v => v.visibility.isGlobal);
        const exclusiveVulns = vulnerabilities.filter(v => !v.visibility.isGlobal);

        const embed = new EmbedBuilder()
            .setTitle(`Day ${currentRound.round_number} Started!`)
            .setColor('#4CAF50')
            .setDescription('A new day has begun! Hunt for vulnerabilities and earn rewards!')
            .addFields(
                { name: 'New Vulnerabilities', value: `${vulnerabilities.length}`, inline: true },
                { name: 'Global', value: `${globalVulns.length}`, inline: true },
                { name: 'Round Ends', value: `<t:${Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000)}:R>`, inline: false }
            )
            .setFooter({ text: `Use /report to submit your findings!` })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Error announcing new round:', error);
        throw error;
    }
}

/**
 * End previous active round (cleanup function)
 */
async function endPreviousRound() {
    try {
        const activeRound = await Round.findOne({ status: 'active' });
        if (activeRound) {
            // Check if round is older than 24 hours (auto-end)
            const roundAge = Date.now() - activeRound.start_date.getTime();
            if (roundAge > 24 * 60 * 60 * 1000) {
                await Round.findByIdAndUpdate(activeRound._id, {
                    end_date: new Date(),
                    status: 'ended'
                });
                console.log(`Auto-ended round ${activeRound.round_number} (expired)`);
            }
        }
    } catch (error) {
        console.error('Error ending previous round:', error);
    }
}

/**
 * Get current round info
 */
async function getCurrentRound() {
    return await Round.findOne({ status: 'active' });
}

/**
 * Get round history
 */
async function getRoundHistory(limit = 10) {
    return await Round.find({})
        .sort({ round_number: -1 })
        .limit(limit)
        .populate('companies_involved');
}

// Helper functions
function weightedRandom(options) {
    const totalWeight = options.reduce((sum, option) => sum + option.weight, 0);
    let random = Math.random() * totalWeight;

    for (const option of options) {
        random -= option.weight;
        if (random <= 0) {
            return option;
        }
    }
    return options[0];
}

function weightedRandomChoice(choices, weights) {
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < choices.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return choices[i];
        }
    }
    return choices[0];
}

function generateVulnIdentifier(type, companyName, index) {
    const prefixes = {
        'XSS': 'XSS',
        'SQLi': 'SQLI',
        'CSRF': 'CSRF',
        'IDOR': 'IDOR',
        'RCE': 'RCE',
        'Authentication': 'AUTH'
    };
    const prefix = prefixes[type] || 'VULN';
    const timestamp = Date.now().toString().slice(-4);
    return `${prefix}-${companyName.toUpperCase().replace(/\s+/g, '')}-${(index + 1).toString().padStart(3, '0')}`;
}

function generateVulnDescription(type, companyName, severity) {
    const descriptions = {
        'XSS': `${severity} severity cross-site scripting vulnerability found in ${companyName}'s web application.`,
        'SQLi': `${severity} severity SQL injection vulnerability in ${companyName}'s database layer.`,
        'CSRF': `${severity} severity cross-site request forgery vulnerability in ${companyName}'s authentication system.`,
        'IDOR': `${severity} severity insecure direct object reference in ${companyName}'s access controls.`,
        'RCE': `${severity} severity remote code execution vulnerability in ${companyName}'s infrastructure.`,
        'Authentication': `${severity} severity authentication bypass vulnerability in ${companyName}'s security system.`
    };
    return descriptions[type] || `${severity} severity security vulnerability discovered in ${companyName}.`;
}

function formatDuration(start, end) {
    const diff = end.getTime() - start.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
}

// Auto-round management (run on bot startup)
async function initializeRoundSystem() {
    try {
        // Check if we need to start a new round
        const activeRound = await Round.findOne({ status: 'active' });

        if (!activeRound) {
            console.log('No active round found. Starting new round...');
            await generateDailyVulnerabilities();
        } else {
            // Check if current round is expired
            const roundAge = Date.now() - activeRound.start_date.getTime();
            if (roundAge > 24 * 60 * 60 * 1000) {
                console.log('Current round expired. Starting new round...');
                await endPreviousRound();
                await generateDailyVulnerabilities();
            } else {
                const remaining = 24 * 60 * 60 * 1000 - roundAge;
                console.log(`Round ${activeRound.round_number} active. Ends in ${Math.floor(remaining / (1000 * 60 * 60))} hours.`);
            }
        }
    } catch (error) {
        console.error('Error initializing round system:', error);
    }
}

module.exports = {
    generateDailyVulnerabilities,
    generateVulnerabilitiesForCompanies, 
    endRound,
    announceNewRound,
    getCurrentRound,
    getRoundHistory,
    initializeRoundSystem,
    endPreviousRound
};