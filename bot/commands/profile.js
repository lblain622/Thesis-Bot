const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const User = require("../../models/Users");
const cache = require("../utils/cache");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("View Your Profile"),

  async execute(interaction) {
    try {

      let user = cache.getUser(interaction.user.id);

      if (!user) {
        user = await User.findOne({ discord_id: interaction.user.id }).lean();

        if (!user) {
          user = await User.create({
            discord_id: interaction.user.id,
            username: interaction.user.username,
          });
        }


        cache.setUser(interaction.user.id, user);
      }

      // Fetch full user with inventory populated
      const fullUser = await User.findOne({ discord_id: interaction.user.id })
        .populate("inventory.item_id")
        .populate("inventory.company_id")
        .lean();

      if (!fullUser) {
        return interaction.reply({
          content: "Could not load your profile. Try again.",
          ephemeral: true,
        });
      }

      const inv = Array.isArray(fullUser.inventory) ? fullUser.inventory : [];
      const previewMax = 10;

      const preview = inv.slice(0, previewMax).map((e) => {
        const name = e.item_id?.name || "Unknown Item";
        const key = e.item_id?.key || "";
        const qty = e.qty || 0;
        const comp = e.company_id?.name ? ` (Company: ${e.company_id.name})` : "";
        return `${name} [${key}] x${qty}${comp}`;
      });

      const embdVar = new EmbedBuilder()
        .setTitle(`${interaction.user.username}'s Profile`)
        .setThumbnail(interaction.user.displayAvatarURL())
        .addFields(
          { name: "Reports Submitted", value: `${user.reports_made || 0} reports`, inline: true },
          { name: "Balance", value: `$${user.money_earned || 0}`, inline: true },
          { name: "Reputation Given", value: `${user.reputation_earned || 0} points`, inline: true }
        );

      if (preview.length) {
        let invText = preview.join("\n");
        const extra = Math.max(0, inv.length - previewMax);
        if (extra > 0) invText += `\n+${extra} more — use /shop inventory for details`;

        embdVar.addFields({ name: "Inventory", value: invText });
      }

      await interaction.reply({
        embeds: [embdVar],
        ephemeral: true,
      });

    } catch (err) {
      console.error("Profile command error:", err);
      if (!interaction.replied) {
        await interaction.reply({
          content: "Something went wrong while loading your profile.",
          ephemeral: true,
        });
      }
    }
  },
};
