const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    EmbedBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');


module.export = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Shop for cool items')
}