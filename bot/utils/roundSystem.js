
const Vulnerability = require('../../models/Volunerabilies');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Report = require('../../models/Reports');
const { EmbedBuilder } = require('discord.js');

/**
 * Generate daily vulnerabilities for a new round
 */
async function generateDailyVulnerabilities() {
    try {
        // Get all companies
        const companies = await Company.find({});
        if (!companies.length) {
            throw new Error('No companies found in database');
        }

        // End previous active round if exists
        await endPreviousRound();

        // Get next round number
        const lastRound = await Round.findOne().sort({ round_number: -1 });
        const roundNumber = lastRound ? lastRound.round_number + 1 : 1;

        // Create new round
        const round = await Round.create({
            round_number: roundNumber,
            companies_involved: companies.map(c => c._id)
        });

        const vulnerabilities = [];
        const vulnCount = Math.min(companies.length * 2, 50); // Max 50 vulnerabilities

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
            { severity: 'Low', weight: 0.4, cvssRange: [0.1, 3.9] },
            { severity: 'Medium', weight: 0.35, cvssRange: [4.0, 6.9] },
            { severity: 'High', weight: 0.2, cvssRange: [7.0, 8.9] },
            { severity: 'Critical', weight: 0.05, cvssRange: [9.0, 10.0] }
        ];

        for (let i = 0; i < vulnCount; i++) {
            const company = companies[Math.floor(Math.random() * companies.length)];

            // Weighted random type selection
            const type = weightedRandom(vulnTypes);

            // Weighted random severity selection
            const severityConfig = weightedRandom(severities);
            const cvssScore = calculateRandomCVSS(severityConfig.cvssRange);

            // Determine visibility (80% global, 20% exclusive)
            const isGlobal = Math.random() < 0.8;

            const vulnerability = await Vulnerability.create({
                company_id: company._id,
                vuln_identifier: generateVulnIdentifier(type, i + 1),
                volun_type: type.type,
                name: `${type.type} in ${company.name}`,
                cvss_score: cvssScore,
                severity: severityConfig.severity,
                description: generateVulnDescription(type.type, company.name),
                isReported: false,
                isResolved: false,
                round_id: round._id,
                visibility: {
                    isGlobal: isGlobal,
                    allowedUsers: isGlobal ? [] : [getRandomExclusiveUser()]
                },
                expiration_date: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            });

            vulnerabilities.push(vulnerability);
        }

        // Update round with vulnerability count
        await Round.findByIdAndUpdate(round._id, {
            vulnerabilities_generated: vulnerabilities.length
        });

        console.log(`Generated ${vulnerabilities.length} vulnerabilities for round ${roundNumber}`);
        return vulnerabilities;

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
//                { name: 'Exclusive', value: `${exclusiveVulns.length}`, inline: true },
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

function calculateRandomCVSS(range) {
    const [min, max] = range;
    return Math.round((Math.random() * (max - min) + min) * 10) / 10;
}

function generateVulnIdentifier(type, index) {
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
    return `${prefix}-${timestamp}-${index}`;
}

function generateVulnDescription(type, companyName) {
    const descriptions = {
        'XSS': `Cross-site scripting vulnerability found in ${companyName}'s web application allowing arbitrary script execution.`,
        'SQLi': `SQL injection vulnerability in ${companyName}'s database layer potentially exposing sensitive information.`,
        'CSRF': `Cross-site request forgery vulnerability in ${companyName}'s authentication system.`,
        'IDOR': `Insecure direct object reference allowing unauthorized access to user data in ${companyName}.`,
        'RCE': `Remote code execution vulnerability in ${companyName}'s server infrastructure.`,
        'Authentication': `Authentication bypass vulnerability in ${companyName}'s login system.`
    };
    return descriptions[type] || `Security vulnerability discovered in ${companyName}.`;
}

function getRandomExclusiveUser() {
    // TODO: Get Random user for Db
    //
    return null;
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
    endRound,
    announceNewRound,
    getCurrentRound,
    getRoundHistory,
    initializeRoundSystem,
    endPreviousRound
};