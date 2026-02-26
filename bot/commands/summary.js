const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const User = require('../../models/Users');
const Log = require('../../models/Log');

// We don't need ensureUserExists here; we'll create the user record if missing.

module.exports = {
    data: new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Show the five most recent actions you have performed'),
    async execute(interaction) {
        try {
            let userDoc = await User.findOne({ discord_id: interaction.user.id });   

            const logs = await Log.find({ user_id: userDoc._id })
                .sort({ createdAt: -1 })
                .limit(5)
                .lean();

            if (!logs.length) {
                return interaction.reply({ content: 'No recent actions found.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(`${interaction.user.username}'s Recent Actions`)
                .setDescription('Here are your last 5 commands:');

            logs.forEach(log => {
                const time = log.createdAt.toLocaleString();
                embed.addFields({ name: time, value: log.action });
            });

            await interaction.reply({ embeds: [embed], ephemeral: true });
        } catch (err) {
            console.error('Summary command error:', err);
            if (!interaction.replied) {
                await interaction.reply({ content: 'Failed to retrieve action summary.', ephemeral: true });
            }
        }
    },
};
