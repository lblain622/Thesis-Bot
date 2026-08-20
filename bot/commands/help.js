const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Learn how to play and find the right command'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xF4B942)
            .setTitle('HexaHive — Quick Start')
            .setDescription('Use these steps to get into the game. Most commands must be run in your personal dashboard channel.')
            .addFields(
                {name: '1 · Set up your dashboard', value: 'Run `/verify` first. This creates your player profile and personal command channel.'},
                {name: '2 · Find an opportunity', value: 'Run `/search` to discover vulnerabilities, then use `/info` to inspect one before acting.'},
                {name: '3 · Choose a strategy', value: 'Report responsibly with `/report`, or manage an accessible vulnerability with `/exploit start`, `/exploit collect`, and `/exploit stop`.'},
                {name: 'Manage your progress', value: '`/profile` stats · `/inventory` owned items · `/shop list` and `/shop buy` upgrades · `/summary` recent activity'},
                {name: 'Trade with another player', value: 'Use `/trade user:@player`. Trade prompts guide both players through selection and final confirmation.'},
                {name: 'Useful details', value: 'Search has a one-minute cooldown. Shop stock rotates periodically. Offer messages include a payout and bonus breakdown.'}
            )
            .setFooter({text: 'Tip: Discord will show each command’s options as you type.'});

        await interaction.reply({embeds: [embed], ephemeral: true});
    }
};
