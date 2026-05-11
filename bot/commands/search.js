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

const FIELD_LABELS = {
    networkAccess: 'Network access',
    arbitraryCodeExecution: 'Arbitrary code execution',
    userInteraction: 'User interaction',
    automatable: 'Automatable',
    confidentialityImpact: 'Confidentiality impact',
    integrityImpact: 'Integrity impact',
    availabilityImpact: 'Availability impact',
    privilegesRequired: 'Privileges required',
    recoveryPotential: 'Recovery potential',
};

function hasUserId(ids, userId) {
    return (ids || []).some(id => id.toString() === userId.toString());
}

function getUnrevealedFields(vulnerability, userId) {
    return REVEALABLE_FIELDS.filter(field => {
        const value = vulnerability[field];
        return value?.answer && !hasUserId(value.visibleTo, userId);
    });
}

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
            
            // Check search cooldown
            const baseCooldownMs = 5 * 60 * 1000; // 5 minutes
            const invEntries = await fetchInventoryItems(user);
            const boosts = aggSearchBoosts(invEntries);
            const cooldownReductionPct = boosts.cooldownReductionPct || 0;
            const actualCooldownMs = baseCooldownMs * (1 - cooldownReductionPct / 100);
            
            if (user.last_search) {
                const timeSinceLastSearch = now.getTime() - new Date(user.last_search).getTime();
                if (timeSinceLastSearch < actualCooldownMs) {
                    const remainingMs = actualCooldownMs - timeSinceLastSearch;
                    const remainingMins = Math.ceil(remainingMs / 60000);
                    return interaction.editReply({
                        content: `⏳ Search cooldown active. Try again in **${remainingMins} minute(s)**.${cooldownReductionPct > 0 ? ` (reduced by ${cooldownReductionPct}% via items)` : ''}`,
                        flags: 64
                    });
                }
            }

            // Update last_search timestamp
            await User.updateOne({_id: user._id}, {$set: {last_search: now}});

            // Query all active vulnerabilities (non-expired, not resolved)
            const candidates = await Vulnerability.find({
                expiration_date: {$gt: now},
                isResolved: false
            }).populate('company_id', 'name');

            if (!candidates.length) {
                return interaction.editReply({
                    content: '🔍 No active vulnerabilities found. The landscape is quiet for now...',
                    flags: 64
                });
            }

            // Split into new discoveries and previously discovered vulnerabilities that still have hidden data.
            const accessible = [];
            const inaccessible = [];
            for (const v of candidates) {
                const isAccessible = v.visibility?.isGlobal || hasUserId(v.visibility?.allowedUsers, user._id);
                (isAccessible ? accessible : inaccessible).push(v);
            }

            // Discover base 2 new vulnerabilities, boosted by items
            const baseDiscover = 2 + (boosts.extraDiscover || 0);
            const toDiscover = inaccessible
                .sort(() => 0.5 - Math.random())
                .slice(0, Math.min(baseDiscover, inaccessible.length));

            const accessibleWithHiddenInfo = accessible.filter(v => getUnrevealedFields(v, user._id).length > 0);

            // Build the set of found vulnerabilities: new discoveries first, then new intel for old discoveries.
            const foundCap = 5; // keep global cap for balance
            const found = [
                ...toDiscover,
                ...accessibleWithHiddenInfo.sort(() => 0.5 - Math.random())
            ].slice(0, foundCap);

            // Mutations to apply: add user to allowedUsers for discovered, reveal random fields, add discovered_by
            const savePromises = [];
            const resultDetails = [];
            for (const v of found) {
                const wasAccessible = v.visibility?.isGlobal || hasUserId(v.visibility?.allowedUsers, user._id);
                if (!wasAccessible) {
                    v.visibility = v.visibility || {isGlobal: false, allowedUsers: []};
                    v.visibility.allowedUsers = v.visibility.allowedUsers || [];
                    if (!hasUserId(v.visibility.allowedUsers, user._id)) {
                        v.visibility.allowedUsers.push(user._id);
                    }
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
                const fieldsToReveal = getUnrevealedFields(v, user._id)
                    .sort(() => 0.5 - Math.random())
                    .slice(0, revealCount);
                const revealedFields = [];
                for (const field of fieldsToReveal) {
                    if (!v[field]?.answer) continue;
                    v[field].visibleTo = v[field].visibleTo || [];
                    if (!hasUserId(v[field].visibleTo, user._id)) {
                        v[field].visibleTo.push(user._id);
                        revealedFields.push(field);
                    }
                }

                if (!wasAccessible || revealedFields.length) {
                    resultDetails.push({
                        vulnerability: v,
                        isNewDiscovery: !wasAccessible,
                        revealedFields
                    });
                    savePromises.push(v.save());
                }
            }

            await Promise.all(savePromises);

            // If still nothing accessible after attempt
            if (!resultDetails.length) {
                return interaction.editReply({
                    content: 'You didn\'t find any new vulnerabilities or new details this time. Try again in a bit!',
                    flags: 64
                });
            }

            // Build response embed
            const embed = new EmbedBuilder()
                .setTitle('🔎 Search Results')
                .setDescription('You scouted the landscape and found useful leads:')
                .setTimestamp(new Date());

            for (const detail of resultDetails) {
                const v = detail.vulnerability;
                const companyName = v.company_id?.name || 'Unknown Company';
                const remaining = v.expiration_date ? formatRemaining(v.expiration_date) : 'unknown';
                const status = detail.isNewDiscovery
                    ? 'New discovery'
                    : 'New intel on a previously discovered vulnerability';
                const revealed = detail.revealedFields.length
                    ? `\nLearned: ${detail.revealedFields.map(field => FIELD_LABELS[field] || field).join(', ')}`
                    : '';
                embed.addFields({
                    name: `${v.vuln_identifier}`,
                    value: `Status: ${status}\nCompany: ${companyName}\nType: ${v.volun_type}\nTime left: ${remaining}${revealed}`,
                    inline: false,
                });
            }

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
