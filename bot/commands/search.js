const {
    SlashCommandBuilder,
    EmbedBuilder,
} = require('discord.js');
const Vulnerability = require('../../models/Vulnerabilities');
const User = require('../../models/Users');
const Company = require('../../models/Company');
const {fetchInventoryItems, aggSearchBoosts} = require('../utils/shopEffects');

function formatRemaining(expiration) {
    const ms = new Date(expiration).getTime() - Date.now();
    if (ms <= 0) return 'expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
}

// Fields on Vulnerabilities that support per-user visibility
const REVEALABLE_FIELDS = [
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

const BASE_COOLDOWN_MS = 5 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Actively search to discover vulnerabilities and reveal some fields'),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const user = await User.findOne({discord_id: interaction.user.id});
            if (!user) {
                return interaction.editReply({content: 'User record not found.', flags: 64});
            }

            const now = new Date();

            // ---------- COOLDOWN CHECK ----------
            // Fetch inventory items to get cooldown reduction effects
            const invEntries = await fetchInventoryItems(user);
            const boosts = aggSearchBoosts(invEntries);

            // Calculate effective cooldown
            let cooldownReductionMs = 0;

            // Check for cooldown reduction items
            if (boosts.cooldownReductionPct) {
                cooldownReductionMs = Math.floor(BASE_COOLDOWN_MS * (boosts.cooldownReductionPct / 100));
            }

            // Check for specific search time reduction
            if (boosts.searchTimeReductionPct) {
                cooldownReductionMs += Math.floor(BASE_COOLDOWN_MS * (boosts.searchTimeReductionPct / 100));
            }

            // Stackable cooldown items (e.g., multiple small reductions)
            if (boosts.flatCooldownReductionMs) {
                cooldownReductionMs += boosts.flatCooldownReductionMs;
            }

            // Cap cooldown reduction at 80% max
            const maxReduction = Math.floor(BASE_COOLDOWN_MS * 0.8);
            if (cooldownReductionMs > maxReduction) {
                cooldownReductionMs = maxReduction;
            }

            const effectiveCooldownMs = BASE_COOLDOWN_MS - cooldownReductionMs;

            // Check if user is on cooldown
            if (user.last_search_time) {
                const lastSearch = new Date(user.last_search_time);
                const timeSinceLastSearch = now.getTime() - lastSearch.getTime();

                if (timeSinceLastSearch < effectiveCooldownMs) {
                    const remainingMs = effectiveCooldownMs - timeSinceLastSearch;
                    const remainingMinutes = Math.floor(remainingMs / 60000);
                    const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);

                    const cooldownEmbed = new EmbedBuilder()
                        .setTitle('Search Cooldown')
                        .setDescription(`You must wait before searching again.`)
                        .setColor(0xFFA500)
                        .addFields(
                            {
                                name: 'Time Remaining',
                                value: `${remainingMinutes}m ${remainingSeconds}s`,
                                inline: true
                            },
                            {
                                name: 'Base Cooldown',
                                value: `5 minutes`,
                                inline: true
                            },
                            {
                                name: 'Your Cooldown',
                                value: `${(effectiveCooldownMs / 1000 / 60).toFixed(1)} minutes`,
                                inline: true
                            }
                        )
                        .setFooter({ text: 'Use items to reduce cooldown!' })
                        .setTimestamp();

                    return interaction.editReply({embeds: [cooldownEmbed], flags: 64});
                }
            }

            // ---------- SEARCH EXECUTION ----------
            // Update user's last search time
            user.last_search_time = now;
            await user.save();

            // Compute search boosts from inventory (already fetched)
            // Candidates: currently active vulnerabilities
            const candidates = await Vulnerability.find({
                isResolved: false,
                isReported: false,
                expiration_date: {$gt: now},
            }).populate('company_id');

            if (!candidates.length) {
                return interaction.editReply({
                    content: 'No active vulnerabilities available at the moment. Try again soon!',
                    flags: 64
                });
            }

            // Split into accessible and inaccessible; allow discovering a few new ones
            const accessible = [];
            const inaccessible = [];
            for (const v of candidates) {
                const isAccessible = v.visibility?.isGlobal || (v.visibility?.allowedUsers || []).some(u => u.toString() === user._id.toString());
                (isAccessible ? accessible : inaccessible).push(v);
            }

            // Discover base 2 new vulnerabilities, boosted by items
            const baseDiscover = 2 + (boosts.extraDiscover || 0);
            const toDiscover = inaccessible
                .sort(() => 0.5 - Math.random())
                .slice(0, Math.min(baseDiscover, inaccessible.length));

            // Build the set of found vulnerabilities: already accessible + newly discovered (cap to 5 total)
            const foundCap = 5;
            const found = [...accessible, ...toDiscover].slice(0, foundCap);

            // Mutations to apply: add user to allowedUsers for discovered, reveal random fields, add discovered_by
            const savePromises = [];
            for (const v of found) {
                const wasAccessible = v.visibility?.isGlobal || (v.visibility?.allowedUsers || []).some(u => u.toString() === user._id.toString());
                if (!wasAccessible) {
                    v.visibility = v.visibility || {isGlobal: false, allowedUsers: []};
                    v.visibility.allowedUsers = v.visibility.allowedUsers || [];
                    v.visibility.allowedUsers.push(user._id);
                }

                // Track discovery
                const alreadyDiscovered = (v.discovered_by || []).some(d => d.user_id?.toString() === user._id.toString());
                if (!alreadyDiscovered) {
                    v.discovered_by = v.discovered_by || [];
                    v.discovered_by.push({user_id: user._id, discovered_at: new Date()});
                }

                // Reveal 2-4 fields for the user, boosted by items (Signal Booster etc.)
                const baseMin = 2;
                const baseMax = 4;
                const randBase = Math.min(baseMax, Math.max(baseMin, Math.ceil(Math.random() * baseMax)));
                const revealCount = Math.min(baseMax + (boosts.extraFields || 0), randBase + (boosts.extraFields || 0));
                const fieldsToReveal = REVEALABLE_FIELDS
                    .sort(() => 0.5 - Math.random())
                    .slice(0, revealCount);
                for (const field of fieldsToReveal) {
                    if (!v[field]) continue;
                    v[field].visibleTo = v[field].visibleTo || [];
                    if (!v[field].visibleTo.some(id => id.toString() === user._id.toString())) {
                        v[field].visibleTo.push(user._id);
                    }
                }

                savePromises.push(v.save());
            }

            await Promise.all(savePromises);

            // If still nothing accessible after attempt
            if (!found.length) {
                return interaction.editReply({
                    content: 'You didn\'t find anything this time. Try again in a bit!',
                    flags: 64
                });
            }

            // Build response embed
            const embed = new EmbedBuilder()
                .setTitle('🔎 Search Results')
                .setDescription('You scouted the landscape and found some leads:')
                .setColor(0x00FF00)
                .setTimestamp(new Date());

            for (const v of found) {
                const companyName = v.company_id?.name || 'Unknown Company';
                const remaining = v.expiration_date ? formatRemaining(v.expiration_date) : 'unknown';
                embed.addFields({
                    name: `${v.vuln_identifier}`,
                    value: `Company: ${companyName}\nType: ${v.volun_type}\nTime left: ${remaining}`,
                    inline: false,
                });
            }

            // Add cooldown info to embed
            const cooldownMinutes = (effectiveCooldownMs / 1000 / 60).toFixed(1);
            embed.setFooter({
                text: `Cooldown: ${cooldownMinutes} minutes | You can search again ${formatRemaining(new Date(now.getTime() + effectiveCooldownMs))}`
            });

            await interaction.editReply({embeds: [embed], flags: 64});
        } catch (err) {
            console.error('search command error:', err);
            return interaction.editReply({
                content: 'There was an error during your search. Please try again later.',
                flags: 64
            });
        }
    }
}