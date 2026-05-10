const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Users = require('../../models/Users');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('inventory')
        .setDescription('View your owned items'),

    async execute(interaction) {
        await interaction.deferReply({ flags: 64 });

        const user = await Users.findOne({ discord_id: interaction.user.id }).populate('inventory.item_id').populate('inventory.company_id');
        if (!user) return interaction.editReply({ content: 'User not found.' });

        const inv = user.inventory || [];
        if (!inv.length) return interaction.editReply({ content: 'Your inventory is empty.' });

        const embed = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Inventory`)
            .setColor('#7289DA');

        for (const e of inv) {
            const name = e.item_id?.name || 'Unknown Item';
            const key = e.item_id?.key || '';
            const qty = e.qty || 0;
            const comp = e.company_id?.name ? ` — ${e.company_id.name}` : '';
            embed.addFields({ name: `${name}${comp}`, value: `Key: ${key} | Qty: ${qty}`, inline: false });
        }

        return interaction.editReply({ embeds: [embed] });
    }
};
