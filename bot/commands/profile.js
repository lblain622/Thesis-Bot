const {SlashCommandBuilder} = require("discord.js");
const User = require("../../models/Users");
module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View Current Profile'),

    async execute(interaction) {
       const user = User.findOne({discord_id:interaction.user.id});

    }
}
