const Vulnerability = require('../../models/Volunerabilies');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Report = require('../../models/Reports');
const Users = require('../../models/Users');
const Exploit = require('../../models/Expoits');
const { EmbedBuilder } = require('discord.js');

/**
 * Generate vulnerabilities with new field structure (for data loading)
 */
// Round timing (defaults) — can be overridden via env
const ROUND_MS = Number(process.env.ROUND_MS || 30 * 60 * 1000);   // 30 minutes
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 2 * 60 * 1000); // 2 minutes
const TICK_MS = Number(process.env.TICK_MS || 5 * 60 * 1000);      // 5 minutes

// scheduler state (per-process, not persisted)
let tickInterval = null;
let roundTimeout = null;
let cooldownTimeout = null;
let autoRunEnabled = false; // becomes true after an admin starts the first round (per user request)

// When game reset happens maybe make a new db on mongo, and make a new collections
//if we do several iterations, I could also manually connect to a new db in the env
//lets see what easier

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


// Utility: format human-readable duration between two dates
function formatDuration(start, end) {
    const ms = Math.max(0, end.getTime() - new Date(start).getTime());
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const parts = [];
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

// Utility: resolve an announcements channel: prefer #announcements, else create, else fallback to #general or first text channel
async function resolveAnnouncementsChannel(client) {
    // Try all guilds the bot is in and pick a suitable channel in the first guild
    const guilds = client.guilds.cache;
    const guild = guilds.first() || (await client.guilds.fetch().then(col => col.first()).catch(() => null));
    if (!guild) return null;
    await guild.channels.fetch();

    let channel = guild.channels.cache.find(ch => ch.type === 0 && ch.name.toLowerCase() === 'announcements');
    if (!channel) {
        channel = guild.channels.cache.find(ch => ch.type === 0 && ch.name.toLowerCase() === 'announcements');
    }
    if (!channel) {
        channel = guild.channels.cache.find(ch => ch.type === 0 && ch.name.toLowerCase().includes('general'));
    }
    if (!channel) {
        // try to create announcements channel
        try {
            // create with preferred name
            channel = await guild.channels.create({ name: 'announcements', type: 0 });
        } catch (_) {
            // fallback: first text channel
            channel = guild.channels.cache.find(ch => ch.type === 0) || null;
        }
    }
    return channel;
}

// Vulnerability generation (placeholder simple generator if not provided elsewhere)
async function generateDailyVulnerabilities() {
    // Determine round number
    const lastRound = await Round.findOne({}).sort({ round_number: -1 });
    const roundNumber = (lastRound?.round_number || 0) + 1;

    const companies = await Company.find({});
    const users = await Users.find({});
    const isGlobal = true; // simple mix: half global, half exclusive

    // Create or reuse active round
    let round = await Round.findOne({ status: 'active' });
    if (!round) {
        round = await Round.create({ round_number: roundNumber, start_date: new Date(), status: 'active' });
    }

    const vulns = [];
    for (const company of companies.slice(0, 5)) { // limit to avoid spam
        const severityOptions = [
            { value: 'Low', weight: 3 },
            { value: 'Medium', weight: 5 },
            { value: 'High', weight: 2 },
            { value: 'Critical', weight: 1 }
        ];
        const chosen = weightedRandom(severityOptions).value;
        const visibilityGlobal = Math.random() < 0.5;
        const allowedUsers = selectAllowedUsers(users, visibilityGlobal);
        const vuln = await Vulnerability.create({
            company_id: company._id,
            vuln_identifier: `VULN-${company._id.toString().slice(-4)}-${Math.floor(Math.random()*10000)}`,
            severity: chosen,
            volun_type: 'Generic',
            round_id: round._id,
            visibility: { isGlobal: visibilityGlobal, allowedUsers },
            isResolved: false
        });
        vulns.push(vuln);
    }

    // Update round counters
    await Round.findByIdAndUpdate(round._id, { $inc: { vulnerabilities_generated: vulns.length } });
    return vulns;
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
            createdAt: { $gte: currentRound.start_date }
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
        let channel = null;
        if (channelId) {
            try { channel = await client.channels.fetch(channelId); } catch (_) { channel = null; }
        }
        if (!channel) channel = await resolveAnnouncementsChannel(client);
        if (!channel) throw new Error('Announcement channel not found');

        const embed = new EmbedBuilder()
            .setTitle(`Round ${currentRound.round_number} Ended`)
            .setColor('#FF6B6B')
            .setDescription(`The round has concluded. Here are the results. Next round starts after cooldown (~${Math.floor(COOLDOWN_MS/60000)}m).`)
            .addFields(
                { name: 'Duration', value: `${formatDuration(currentRound.start_date, new Date())}`, inline: true },
                { name: 'Vulnerabilities', value: `${roundVulns.length}`, inline: true },
                { name: 'Resolved', value: `${resolvedVulns.length}`, inline: true },
                { name: 'Reports Submitted', value: `${roundReports.length}`, inline: true },
                { name: 'Total Payout', value: `$${totalPayout}`, inline: true },
            )
            .setFooter({ text: 'Cooldown in effect' })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

        // Schedule next round after cooldown if auto-run is enabled
        if (cooldownTimeout) clearTimeout(cooldownTimeout);
        cooldownTimeout = setTimeout(async () => {
            try {
                if (autoRunEnabled) {
                    await startRound(client, channelId);
                }
            } catch (error) {
                console.error('Error auto-starting next round:', error);
            }
        }, COOLDOWN_MS);

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
        let channel = null;
        if (channelId) {
            try { channel = await client.channels.fetch(channelId); } catch (_) { channel = null; }
        }
        if (!channel) channel = await resolveAnnouncementsChannel(client);
        if (!channel) throw new Error('Announcement channel not found');

        const currentRound = await Round.findOne({ status: 'active' });
        if (!currentRound) {
            throw new Error('No active round found');
        }

        const globalVulns = vulnerabilities.filter(v => v.visibility.isGlobal);
        const exclusiveVulns = vulnerabilities.filter(v => !v.visibility.isGlobal);

        const embed = new EmbedBuilder()
            .setTitle(`Round ${currentRound.round_number} Started`)
            .setColor('#4CAF50')
            .setDescription('A new round has begun. Hunt for vulnerabilities and earn rewards!')
            .addFields(
                { name: 'New Vulnerabilities', value: `${vulnerabilities.length}`, inline: true },
                { name: 'Global', value: `${globalVulns.length}`, inline: true },
                { name: 'Round Ends', value: `<t:${Math.floor((Date.now() + Math.floor(ROUND_MS/1000)*1000) / 1000)}:R>`, inline: false }
            )
            .setFooter({ text: `Use /report to submit your findings` })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Error announcing new round:', error);
        throw error;
    }
}

// periodic evaluator: payouts, exposure checks, and cumulative summary
async function evaluateTick(client) {
    const currentRound = await Round.findOne({ status: 'active' });
    if (!currentRound) return;

    // cumulative counts
    const [reports, resolvedReports] = await Promise.all([
        Report.find({ createdAt: { $gte: currentRound.start_date } }),
        Report.find({ status: 'resolved', createdAt: { $gte: currentRound.start_date } })
    ]);
    const totalPayout = reports.reduce((sum, r) => sum + (r.offered_amount || 0), 0);

    // process exploits: pay passive income and roll exposure
    const activeExploits = await Exploit.find({ is_caught: false });
    let caughtCount = 0;
    for (const ex of activeExploits) {
        try {
            const user = await Users.findById(ex.user_id);
            const vuln = await Vulnerability.findById(ex.volunerability_id);
            if (!user || !vuln) continue;

            // credit passive earnings
            const credit = ex.money_per_cycle;
            await Users.findByIdAndUpdate(user._id, { $inc: { money_earned: credit } });
            await Exploit.findByIdAndUpdate(ex._id, { $inc: { cycles_completed: 1 }, $set: { last_rewarded: new Date() } });

            // compute exposure probability scaled by duration
            const base = Math.min(1, Math.max(0, ex.exposure_chance));
            const durationBoost = Math.min(0.5, (ex.cycles_completed + 1) * 0.02); // up to +50%
            const exposureProb = Math.min(1, base + durationBoost);
            if (Math.random() < exposureProb) {
                // caught: apply penalty scaled by trust and duration
                const companyId = vuln.company_id;
                const repEntry = (user.reputation_breakdown || []).find(r => r.company_id?.toString() === companyId?.toString());
                const trust = repEntry?.trust_score || 0; // lower trust => harsher
                const trustFactor = 1 + Math.max(0, -trust) / 50; // trust -50 => +2x
                const durationFactor = 1 + Math.min(1, ex.cycles_completed / 12); // up to +2x around 1 hour
                const fineBase = 500;
                const fine = Math.floor(fineBase * trustFactor * durationFactor);

                // subtract fine (not below 0)
                const newMoney = Math.max(0, (user.money_earned || 0) - fine);
                await Users.findByIdAndUpdate(user._id, { $set: { money_earned: newMoney } });

                // reduce trust further
                const penaltyTrust = Math.ceil(10 * durationFactor);
                // ensure entry exists
                if (!repEntry) {
                    await Users.updateOne({ _id: user._id }, {
                        $push: { reputation_breakdown: { company_id: companyId, trust_score: -penaltyTrust } }
                    });
                } else {
                    await Users.updateOne({ _id: user._id, 'reputation_breakdown.company_id': companyId }, {
                        $inc: { 'reputation_breakdown.$.trust_score': -penaltyTrust }
                    });
                }

                // mark as caught
                await Exploit.findByIdAndUpdate(ex._id, { $set: { is_caught: true } });
                caughtCount += 1;

                // DM user
                if (user.discord_id) {
                    try {
                        const duser = await client.users.fetch(user.discord_id);
                        await duser.send(`You have been detected exploiting a vulnerability at ${new Date().toLocaleString()}. Penalty applied: fine $${fine}, trust -${penaltyTrust}.`);
                    } catch (_) { /* ignore DM failures */ }
                }
            }
        } catch (err) {
            console.error('Error processing exploit tick:', err);
        }
    }


    const channel = await resolveAnnouncementsChannel(client);
    if (channel) {
        const embed = new EmbedBuilder()
            .setTitle(`Round ${currentRound.round_number} Update`)
            .setColor('#2E86AB')
            .setDescription('Periodic update for the current round')
            .addFields(
                { name: 'Reports Submitted', value: String(reports.length), inline: true },
                { name: 'Reports Resolved', value: String(resolvedReports.length), inline: true },
                { name: 'Total Payout Offered', value: `$${totalPayout}`, inline: true },
                { name: 'Active Exploits', value: String(Math.max(0, activeExploits.length - caughtCount)), inline: true },
                { name: 'Exploits Detected', value: String(caughtCount), inline: true }
            )
            .setTimestamp();
        try { await channel.send({ embeds: [embed] }); } catch (_) { /* ignore */ }
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


// Start a new round (admin triggered). Enables auto-run loop after the first start.
async function startRound(client, channelId) {
    // clear previous intervals if any
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    if (roundTimeout) { clearTimeout(roundTimeout); roundTimeout = null; }

    autoRunEnabled = true; // after first manual start, rounds autorun per user request

    // end any leftover active round
    const active = await Round.findOne({ status: 'active' });
    if (active) {
        await Round.findByIdAndUpdate(active._id, { status: 'ended', end_date: new Date() });
    }

    // create new active round and generate vulns
    const vulns = await generateDailyVulnerabilities();
    await announceNewRound(client, channelId, vulns);

    // schedule periodic tick and round end
    tickInterval = setInterval(() => { evaluateTick(client).catch(() => {}); }, TICK_MS);
    roundTimeout = setTimeout(async () => {
        try { await endRound(client, channelId); } catch (e) { console.error(e); }
    }, ROUND_MS);
}

// Auto-round management (run on bot startup)
// Resumes active round if present; does not auto-start if none.
async function initializeRoundSystem(client) {
    try {
        const activeRound = await Round.findOne({ status: 'active' });
        if (activeRound) {
            const roundAge = Date.now() - activeRound.start_date.getTime();
            const remaining = Math.max(0, ROUND_MS - roundAge);
            console.log(`Round ${activeRound.round_number} active. Ends in ${Math.ceil(remaining / 60000)} minutes.`);

            // schedule timers
            if (tickInterval) clearInterval(tickInterval);
            tickInterval = setInterval(() => { evaluateTick(client).catch(() => {}); }, TICK_MS);
            if (roundTimeout) clearTimeout(roundTimeout);
            roundTimeout = setTimeout(async () => {
                try { await endRound(client); } catch (e) { console.error(e); }
            }, remaining);
        } else {
            console.log('No active round. Waiting for admin to start the game.');
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
    endPreviousRound,
    startRound,
    // controls
    enableAutoRun: () => { autoRunEnabled = true; },
    disableAutoRun: () => { autoRunEnabled = false; }
};