const Vulnerability = require('../../models/Vulnerabilities');
const Company = require('../../models/Company');
const Round = require('../../models/Round');
const Report = require('../../models/Reports');
const Users = require('../../models/Users');
const Exploit = require('../../models/Exploit');
const { EmbedBuilder } = require('discord.js');
const testVulnData = require('../../data/test-data.json');
const generateOffer = require('./generateOffer');
const generateDictatorOffer = require('./generateDicOffer');
const Platform = require('../../models/Platform');
const CompanyOffer = require('../../models/CompanyOffers');

// Round timing (defaults) — can be overridden via env
const ROUND_MS = Number(process.env.ROUND_MS || 30 * 60 * 1000);   // 30 minutes
const COOLDOWN_MS = Number(process.env.COOLDOWN_MS || 2 * 60 * 1000); // 2 minutes
const TICK_MS = Number(process.env.TICK_MS || 5 * 60 * 1000);      // 5 minutes

// scheduler state (per-process, not persisted)
let tickInterval = null;
let roundTimeout = null;
let cooldownTimeout = null;
let autoRunEnabled = false;

// ===== UTILITY FUNCTIONS =====
function selectAllowedUsers(allUsers, isGlobal) {
    if (isGlobal) {
        return allUsers.map(user => user._id);
    } else {
        const userCount = Math.floor(Math.random() * 3) + 1;
        const shuffledUsers = [...allUsers].sort(() => 0.5 - Math.random());
        return shuffledUsers.slice(0, userCount).map(user => user._id);
    }
}

function formatDuration(start, end) {
    const ms = Math.max(0, end.getTime() - new Date(start).getTime());
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const parts = [];
    if (minutes) parts.push(`${minutes}m`);
    parts.push(`${seconds}s`);
    return parts.join(' ');
}

async function resolveAnnouncementsChannel(client) {
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
        try {
            channel = await guild.channels.create({ name: 'announcements', type: 0 });
        } catch (_) {
            channel = guild.channels.cache.find(ch => ch.type === 0) || null;
        }
    }
    return channel;
}

// ===== TIMER MANAGEMENT =====
function cleanupTimers() {
    if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
    }
    if (roundTimeout) {
        clearTimeout(roundTimeout);
        roundTimeout = null;
    }
    if (cooldownTimeout) {
        clearTimeout(cooldownTimeout);
        cooldownTimeout = null;
    }
}

// ===== VULNERABILITY GENERATION =====
async function generateDailyVulnerabilities() {
    const lastRound = await Round.findOne({}).sort({ round_number: -1 });
    const roundNumber = (lastRound?.round_number || 0) + 1;

    const companies = await Company.find({});
    const users = await Users.find({});

    // Create or reuse active round
    let round = await Round.findOne({ status: 'active' });
    if (!round) {
        round = await Round.create({ round_number: roundNumber, start_date: new Date(), status: 'active' });
    }

    const vulns = [];
    const companiesToUse = companies.slice(0, 5);
    for (let i = 0; i < companiesToUse.length; i++) {
        const company = companiesToUse[i];
        const data = testVulnData[i % testVulnData.length];

        const visibilityGlobal = Math.random() < 0.5;
        const allowedUsers = selectAllowedUsers(users, visibilityGlobal);

        const pickAnswer = (val) => {
            if (val == null) return undefined;
            if (typeof val === 'string') return val;
            if (typeof val === 'object' && typeof val.answer === 'string') return val.answer;
            return undefined;
        };

        const severity = typeof data.severity === 'string' ? data.severity : pickAnswer(data.severity) || 'LOW';

        const toField = (val) => ({ answer: val, visibleTo: [] });
        const networkAccess = toField(data?.networkAccess);
        const arbitraryCodeExecution = toField(data?.arbitraryCodeExecution);
        const userInteraction = toField(data?.userInteraction);
        const automatable = toField(data?.automatable);
        const confidentialityImpact = toField(data?.confidentialityImpact);
        const integrityImpact = toField(data?.integrityImpact);
        const availabilityImpact = toField(data?.availabilityImpact);
        const privilegesRequired = toField(data?.privilegesRequired);
        const recoveryPotential = toField(data?.recoveryPotential);

        const vuln = await Vulnerability.create({
            company_id: company._id,
            round_id: round._id,
            vuln_identifier: `${data.id}-${company._id.toString().slice(-4)}`,
            name: data.id,
            description: data.description,
            volun_type: data.volun_type,
            severity,
            networkAccess,
            arbitraryCodeExecution,
            userInteraction,
            automatable,
            confidentialityImpact,
            integrityImpact,
            availabilityImpact,
            privilegesRequired,
            recoveryPotential,
            visibility: { isGlobal: visibilityGlobal, allowedUsers },
            isResolved: false
        });
        vulns.push(vuln);
    }

    await Round.findByIdAndUpdate(round._id, { $inc: { vulnerabilities_generated: vulns.length } });
    return vulns;
}

// ===== ROUND END =====
async function endRound(client, channelId) {
    try {
        cleanupTimers(); // Clear existing timers first

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
                    console.log(`Cooldown ended, starting next round automatically`);
                    await startRound(client, channelId);
                } else {
                    console.log(`Cooldown ended but auto-run disabled, waiting for manual start`);
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
        cleanupTimers();
        throw error;
    }
}

// ===== ANNOUNCE NEW ROUND =====
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

        // FIXED: Correct timestamp calculation
        const roundEndTimestamp = Math.floor((Date.now() + ROUND_MS) / 1000);

        const embed = new EmbedBuilder()
            .setTitle(`Round ${currentRound.round_number} Started`)
            .setColor('#4CAF50')
            .setDescription('A new round has begun. Hunt for vulnerabilities and earn rewards!')
            .addFields(
                { name: 'New Vulnerabilities', value: `${vulnerabilities.length}`, inline: true },
                { name: 'Global', value: `${globalVulns.length}`, inline: true },
                { name: 'Exclusive', value: `${exclusiveVulns.length}`, inline: true },
                { name: 'Round Ends', value: `<t:${roundEndTimestamp}:R>`, inline: false }
            )
            .setFooter({ text: `Use /report to submit your findings` })
            .setTimestamp();

        await channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Error announcing new round:', error);
        throw error;
    }
}

// ===== TICK EVALUATION =====
async function evaluateTick(client) {
    const currentRound = await Round.findOne({ status: 'active' });
    if (!currentRound) return;

    try {
        // cumulative counts
        const [reports, resolvedReports] = await Promise.all([
            Report.find({ createdAt: { $gte: currentRound.start_date } }),
            Report.find({ status: 'resolved', createdAt: { $gte: currentRound.start_date } })
        ]);
        const totalPayout = reports.reduce((sum, r) => sum + (r.offered_amount || 0), 0);

        // process exploits
        const activeExploits = await Exploit.find({ is_caught: false });
        let caughtCount = 0;
        for (const ex of activeExploits) {
            try {
                const user = await Users.findById(ex.user_id);
                const vuln = await Vulnerability.findById(ex.volunerability_id);
                if (!user || !vuln) continue;

                // If vulnerability is resolved, end associated exploit immediately (no more income)
                if (vuln.isResolved) {
                    await Exploit.findByIdAndUpdate(ex._id, { $set: { is_caught: true } });
                    caughtCount += 1;
                    continue;
                }

                // credit passive earnings
                const credit = ex.money_per_cycle;
                await Users.findByIdAndUpdate(user._id, { $inc: { money_earned: credit } });
                await Exploit.findByIdAndUpdate(ex._id, { $inc: { cycles_completed: 1 }, $set: { last_rewarded: new Date() } });

                // compute exposure probability
                const base = Math.min(1, Math.max(0, ex.exposure_chance));
                const durationBoost = Math.min(0.5, (ex.cycles_completed + 1) * 0.02);
                const exposureProb = Math.min(1, base + durationBoost);
                if (Math.random() < exposureProb) {
                    // caught logic
                    const companyId = vuln.company_id;
                    const repEntry = (user.reputation_breakdown || []).find(r => r.company_id?.toString() === companyId?.toString());
                    const trust = repEntry?.trust_score || 0;
                    const trustFactor = 1 + Math.max(0, -trust) / 50;
                    const durationFactor = 1 + Math.min(1, ex.cycles_completed / 12);
                    const fineBase = 500;
                    const fine = Math.floor(fineBase * trustFactor * durationFactor);

                    const newMoney = Math.max(0, (user.money_earned || 0) - fine);
                    await Users.findByIdAndUpdate(user._id, { $set: { money_earned: newMoney } });

                    const penaltyTrust = Math.ceil(10 * durationFactor);
                    if (!repEntry) {
                        await Users.updateOne({ _id: user._id }, {
                            $push: { reputation_breakdown: { company_id: companyId, trust_score: -penaltyTrust } }
                        });
                    } else {
                        await Users.updateOne({ _id: user._id, 'reputation_breakdown.company_id': companyId }, {
                            $inc: { 'reputation_breakdown.$.trust_score': -penaltyTrust }
                        });
                    }

                    await Exploit.findByIdAndUpdate(ex._id, { $set: { is_caught: true } });
                    caughtCount += 1;

                    if (user.discord_id) {
                        try {
                            const duser = await client.users.fetch(user.discord_id);
                            await duser.send(`You have been detected exploiting a vulnerability at ${new Date().toLocaleString()}. Penalty applied: fine $${fine}, trust -${penaltyTrust}.`);
                        } catch (_) { }
                    }
                }
            } catch (err) {
                console.error('Error processing exploit tick:', err);
            }
        }

        // Auto-offer evaluation
        try {
            await evaluateAutoOffers(client);
        } catch (e) {
            console.error('Auto-offer evaluation failed:', e);
        }

        // Send periodic update
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
            try { await channel.send({ embeds: [embed] }); } catch (_) { }
        }
    } catch (error) {
        console.error('Error in evaluateTick:', error);
    }
}

// ===== START ROUND =====
async function startRound(client, channelId) {
    try {
        // Clear all previous timers
        cleanupTimers();

        // Enable auto-run if not already
        autoRunEnabled = true;

        // End any leftover active round
        const active = await Round.findOne({ status: 'active' });
        if (active) {
            console.log(`Ending existing round ${active.round_number} before starting new one`);
            await Round.findByIdAndUpdate(active._id, {
                status: 'ended',
                end_date: new Date(),
                auto_ended: true
            });
        }

        // Create new round and generate vulnerabilities
        console.log('Generating vulnerabilities for new round...');
        const vulns = await generateDailyVulnerabilities();

        if (!vulns || vulns.length === 0) {
            throw new Error('Failed to generate vulnerabilities');
        }

        await announceNewRound(client, channelId, vulns);

        // Schedule periodic ticks
        tickInterval = setInterval(() => {
            evaluateTick(client).catch(e => console.error('Tick error:', e));
        }, TICK_MS);

        // Schedule round end
        roundTimeout = setTimeout(async () => {
            try {
                console.log(`Round timeout reached, ending round...`);
                await endRound(client, channelId);
            } catch (e) {
                console.error('Auto-end round error:', e);
                // Emergency recovery
                try {
                    const currentRound = await Round.findOne({ status: 'active' });
                    if (currentRound) {
                        await Round.findByIdAndUpdate(currentRound._id, {
                            status: 'ended',
                            end_date: new Date(),
                            auto_ended: true
                        });
                        cleanupTimers();
                    }
                } catch (innerError) {
                    console.error('Emergency recovery failed:', innerError);
                }
            }
        }, ROUND_MS);

        console.log(`Round started successfully. Next tick in ${TICK_MS/60000} minutes, round ends in ${ROUND_MS/60000} minutes`);

        return { success: true, vulnerabilities: vulns.length };

    } catch (error) {
        console.error('Error starting round:', error);
        cleanupTimers();
        throw error;
    }
}

// ===== INITIALIZE SYSTEM =====
async function initializeRoundSystem(client) {
    try {
        cleanupTimers(); // Clear any existing timers first

        const activeRound = await Round.findOne({ status: 'active' });
        if (activeRound) {
            const now = new Date();
            const roundStart = new Date(activeRound.start_date);
            const roundAge = now.getTime() - roundStart.getTime();

            // Check if round is expired
            if (roundAge > ROUND_MS) {
                console.log(`Round ${activeRound.round_number} expired, auto-ending`);
                try {
                    await endRound(client);
                } catch (error) {
                    console.error('Failed to auto-end expired round:', error);
                    // Force end
                    await Round.findByIdAndUpdate(activeRound._id, {
                        status: 'ended',
                        end_date: new Date(),
                        auto_ended: true
                    });
                }
                return;
            }

            const remaining = Math.max(0, ROUND_MS - roundAge);
            console.log(`Resuming round ${activeRound.round_number}. Ends in ${Math.ceil(remaining / 60000)} minutes.`);

            // Schedule tick interval
            tickInterval = setInterval(() => {
                evaluateTick(client).catch(e => console.error('Tick error:', e));
            }, TICK_MS);

            // Schedule round end
            roundTimeout = setTimeout(async () => {
                try {
                    await endRound(client);
                } catch (e) {
                    console.error('Auto-end round error:', e);
                }
            }, remaining);

        } else {
            console.log('No active round found on startup.');
        }
    } catch (error) {
        console.error('Error initializing round system:', error);
        cleanupTimers();
    }
}

// ===== AUTO-OFFER EVALUATION =====
const VISIBILITY_FIELDS = [
    'networkAccess',
    'arbitraryCodeExecution',
    'userInteraction',
    'automatable',
    'confidentialityImpact',
    'integrityImpact',
    'availabilityImpact',
    'privilegesRequired',
    'recoveryPotential',
];

function countVisibleFieldsForUser(vuln, userId) {
    if (!vuln) return 0;
    const uid = userId?.toString();
    let count = 0;
    for (const f of VISIBILITY_FIELDS) {
        const node = vuln[f];
        const list = node?.visibleTo || [];
        if (list.some(x => x?.toString() === uid)) count += 1;
    }
    return count;
}

async function evaluateAutoOffers(client) {
    const reports = await Report.find({ is_poc_only: { $ne: true }, vulnerability_id: { $ne: null } });
    if (!reports.length) return;

    const byVuln = new Map();
    for (const r of reports) {
        const key = r.vulnerability_id?.toString();
        if (!key) continue;
        if (!byVuln.has(key)) byVuln.set(key, []);
        byVuln.get(key).push(r);
    }

    const now = new Date();
    for (const [vulnId, vulnReports] of byVuln.entries()) {
        const vuln = await Vulnerability.findById(vulnId);
        if (!vuln) continue;

        const pendingForVuln = await CompanyOffer.findOne({ report_id: { $in: vulnReports.map(r => r._id) }, status: 'pending' });
        if (pendingForVuln) continue;

        const perUser = new Map();
        for (const r of vulnReports) {
            const uid = r.user_id?.toString();
            if (!uid) continue;
            const visible = countVisibleFieldsForUser(vuln, r.user_id);
            const entry = perUser.get(uid) || { visibleCount: visible, earliestReport: r, earliestAt: r.submitted_at || r.createdAt, count: 0 };
            if (visible > entry.visibleCount) entry.visibleCount = visible;
            const ts = r.submitted_at || r.createdAt;
            if (!entry.earliestAt || (ts && ts < entry.earliestAt)) {
                entry.earliestAt = ts;
                entry.earliestReport = r;
            }
            entry.count = (entry.count || 0) + 1;
            perUser.set(uid, entry);
        }

        if (!perUser.size) continue;

        const totalFields = VISIBILITY_FIELDS.length;
        const fullUsers = Array.from(perUser.entries())
            .filter(([, v]) => v.visibleCount >= totalFields)
            .sort((a, b) => (a[1].earliestAt || now) - (b[1].earliestAt || now));

        let chosenReport = null;
        if (fullUsers.length) {
            chosenReport = fullUsers[0][1].earliestReport;
            await Vulnerability.updateOne({ _id: vuln._id }, { $set: { offer_wait_started_at: null, last_offer_report_id: chosenReport._id } });
        } else {
            if (!vuln.offer_wait_started_at) {
                await Vulnerability.updateOne({ _id: vuln._id }, { $set: { offer_wait_started_at: now } });
                continue;
            }
            const waitedMs = now.getTime() - new Date(vuln.offer_wait_started_at).getTime();
            if (waitedMs < TICK_MS) continue;

            // Fallback after waiting: user who submitted the most, tie-break by earliest submission
            const ranked = Array.from(perUser.entries())
                .sort((a, b) => {
                    if ((b[1].count || 0) !== (a[1].count || 0)) return (b[1].count || 0) - (a[1].count || 0);
                    return (a[1].earliestAt || now) - (b[1].earliestAt || now);
                });
            chosenReport = ranked[0][1].earliestReport;
            await Vulnerability.updateOne({ _id: vuln._id }, { $set: { offer_wait_started_at: null, last_offer_report_id: chosenReport._id } });
        }

        if (!chosenReport) continue;

        const existing = await CompanyOffer.findOne({ report_id: chosenReport._id, status: 'pending' });
        if (existing) continue;

        try {
            const user = await Users.findById(chosenReport.user_id);
            if (!user?.discord_id) continue;
            const duser = await client.users.fetch(user.discord_id);
            // Decide offer type based on platform
            let useDictator = false;
            try {
                if (chosenReport.platform_id) {
                    const platform = await Platform.findById(chosenReport.platform_id);
                    if (platform) {
                        const nameHas = (platform.name || '').toLowerCase().includes('dictator');
                        const variantsHas = Array.isArray(platform.variants) && platform.variants.some(v => String(v).toLowerCase().includes('dictator'));
                        useDictator = nameHas || variantsHas;
                    }
                }
            } catch (_) { /* no-op */ }

            if (useDictator) {
                await generateDictatorOffer(client, chosenReport, duser);
            } else {
                await generateOffer(client, chosenReport, duser);
            }

            // Notify and reward non-selected reporters for this vulnerability
            const losers = vulnReports.filter(r => String(r._id) !== String(chosenReport._id));
            for (const loser of losers) {
                try {
                    const lUser = await Users.findById(loser.user_id);
                    if (lUser?.discord_id) {
                        const lDiscord = await client.users.fetch(lUser.discord_id).catch(() => null);
                        if (lDiscord) {
                            await lDiscord.send({
                                content: `Thanks for your report on ${vuln.vuln_identifier || 'the recent vulnerability'}. Another researcher received the main offer this round. You have been awarded $100 and a reputation bonus for your contribution.`
                            }).catch(() => {});
                        }
                    }
                    // Credit $100 and reputation bonus if not already granted
                    const bonusRep = 10;
                    const updates = {
                        $inc: { money_earned: 100, repuation_earned: bonusRep }
                    };
                    await Users.updateOne({ _id: loser.user_id }, updates);
                    await Report.updateOne({ _id: loser._id }, {
                        $inc: { offered_amount: 100, reputation_bonus: bonusRep },
                        $set: { status: 'closed' }
                    });
                } catch (e) {
                    console.error('Failed to reward/notify non-selected reporter:', e);
                }
            }
        } catch (e) {
            console.error('Failed to send auto-offer:', e);
        }
    }
}

// ===== HELPER FUNCTIONS =====
async function endPreviousRound() {
    try {
        const activeRound = await Round.findOne({ status: 'active' });
        if (activeRound) {
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

async function getCurrentRound() {
    return await Round.findOne({ status: 'active' });
}

async function getRoundHistory(limit = 10) {
    return await Round.find({})
        .sort({ round_number: -1 })
        .limit(limit)
        .populate('companies_involved');
}

async function getRoundStatus() {
    const activeRound = await Round.findOne({ status: 'active' });
    if (!activeRound) {
        return { active: false, message: 'No active round' };
    }

    const now = new Date();
    const elapsed = now.getTime() - activeRound.start_date.getTime();
    const remaining = Math.max(0, ROUND_MS - elapsed);

    return {
        active: true,
        roundNumber: activeRound.round_number,
        startDate: activeRound.start_date,
        elapsedMinutes: Math.floor(elapsed / 60000),
        remainingMinutes: Math.floor(remaining / 60000),
        timers: {
            tickInterval: !!tickInterval,
            roundTimeout: !!roundTimeout,
            cooldownTimeout: !!cooldownTimeout
        },
        autoRunEnabled
    };
}

async function recoverRoundSystem(client) {
    try {
        cleanupTimers();

        const activeRound = await Round.findOne({ status: 'active' });
        const now = new Date();

        if (activeRound) {
            const roundAge = now.getTime() - activeRound.start_date.getTime();

            if (roundAge > ROUND_MS * 2) {
                console.log('Recovery: Round is too old, ending it');
                await endRound(client);
                return { action: 'ended_old_round' };
            }

            await initializeRoundSystem(client);
            return { action: 'resumed_round' };
        }

        return { action: 'no_active_round' };

    } catch (error) {
        console.error('Recovery failed:', error);
        return { action: 'error', error: error.message };
    }
}

// ===== EXPORTS =====
module.exports = {
    generateDailyVulnerabilities,
    endRound,
    announceNewRound,
    getCurrentRound,
    getRoundStatus,
    getRoundHistory,
    initializeRoundSystem,
    endPreviousRound,
    startRound,
    recoverRoundSystem,
    cleanupTimers,
    // controls
    enableAutoRun: () => { autoRunEnabled = true; },
    disableAutoRun: () => { autoRunEnabled = false; },
    getAutoRunStatus: () => autoRunEnabled
};