const {SlashCommandBuilder, EmbedBuilder} = require("discord.js");
const User = require("../../models/Users");
const cache = require('../utils/cache');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile').setDescription('View Your Profile'),


    async execute(interaction) {


        if (!user) {
            user = await User.findOne({discord_id: interaction.user.id}).lean();
            if (!user) {
                user = await User.create({ discord_id: interaction.user.id, username: interaction.user.username });
            }
        }

        const embdVar = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Profile`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields(
                {name:"Reports Submitted", value: `${user.reports_made} reports`},
                {name:"Money Earned", value:`$${user.money_earned}`},
                {name:"Reputation Given",value:`${user.reputation_earned} points`}
            );
        await interaction.reply({embeds: [embdVar],flags: 64,});

    }
}