<<<<<<< HEAD
const {SlashCommandBuilder} = require("discord.js");
=======
const {SlashCommandBuilder, EmbedBuilder} = require("discord.js");
>>>>>>> c72755ba4acdd95fb07d3001cf15845d3f52efc9
const User = require("../../models/Users");
module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
<<<<<<< HEAD
        .setDescription('View Current Profile'),

    async execute(interaction) {
       const user = User.findOne({discord_id:interaction.user.id});

    }
}
=======
        .setDescription('See your profile'),

    async execute(interaction) {
        const user = await User.findOne({discord_id: interaction.user.id});

        const embdVar = new EmbedBuilder()
            .setTitle(`${interaction.user.username}'s Profile`)
            .setThumbnail(interaction.user.displayAvatarURL())
            .addFields(
                {name:"Reports Submitted", value: `${user.reports_made} reports`},
                {name:"Money Earned", value:`$${user.money_earned}`},
                {name:"Reputation Given",value:`${user.repuation_earned} points`}
            );
        await interaction.reply({embeds: [embdVar],flags: 64,});

    }
}
>>>>>>> c72755ba4acdd95fb07d3001cf15845d3f52efc9
