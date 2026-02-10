const {
    SlashCommandBuilder,
    EmbedBuilder,
} = require('discord.js');
const Vulnerability = require('../../models/Vulnerabilities');
const User = require('../../models/Users');
const Company = require('../../models/Company');
const { fetchInventoryItems, aggSearchBoosts } = require('../utils/shopEffects');

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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('search')
        .setDescription('Actively search to discover vulnerabilities and reveal some fields'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        try {
            const user = await User.findOne({ discord_id: interaction.user.id });
            if (!user) {
                return interaction.editReply({ content: 'User record not found.', flags: 64 });
            }

            const now = new Date();

            // Compute search boosts from inventory
            const invEntries = await fetchInventoryItems(user);
            const boosts = aggSearchBoosts(invEntries);
            // Candidates: currently active vulnerabilities
            const candidates = await Vulnerability.find({
                isResolved: false,
                isReported: false,
                expiration_date: { $gt: now },
            }).populate('company_id');

            if (!candidates.length) {
                return interaction.editReply({ content: 'No active vulnerabilities available at the moment. Try again soon!', flags: 64 });
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
            const foundCap = 5; // keep global cap for balance
            const found = [...accessible, ...toDiscover].slice(0, foundCap);

            // Mutations to apply: add user to allowedUsers for discovered, reveal random fields, add discovered_by
            const savePromises = [];
            for (const v of found) {
                const wasAccessible = v.visibility?.isGlobal || (v.visibility?.allowedUsers || []).some(u => u.toString() === user._id.toString());
                if (!wasAccessible) {
                    v.visibility = v.visibility || { isGlobal: false, allowedUsers: [] };
                    v.visibility.allowedUsers = v.visibility.allowedUsers || [];
                    v.visibility.allowedUsers.push(user._id);
                }

                // Track discovery
                const alreadyDiscovered = (v.discovered_by || []).some(d => d.user_id?.toString() === user._id.toString());
                if (!alreadyDiscovered) {
                    v.discovered_by = v.discovered_by || [];
                    v.discovered_by.push({ user_id: user._id, discovered_at: new Date() });
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
                return interaction.editReply({ content: 'You didn\'t find anything this time. Try again in a bit!', flags: 64 });
            }

            // Build response embed
            const embed = new EmbedBuilder()
                .setTitle('🔎 Search Results')
                .setDescription('You scouted the landscape and found some leads:')
                .setTimestamp(new Date());

            for (const v of found) {
                const companyName = v.company_id?.name || 'Unknown Company';
                const remaining = v.expiration_date ? formatRemaining(v.expiration_date) : 'unknown';
                embed.addFields({
                    name: `${v.vuln_identifier} (${v.severity})`,
                    value: `Company: ${companyName}\nType: ${v.volun_type}\nTime left: ${remaining}`,
                    inline: false,
                });
            }

            await interaction.editReply({ embeds: [embed], flags: 64 });
        } catch (err) {
            console.error('search command error:', err);
            return interaction.editReply({ content: 'There was an error during your search. Please try again later.', flags: 64 });
        }
    }
}