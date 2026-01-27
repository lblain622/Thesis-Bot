const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show help about commands and core game concepts'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('Thesis-Bot Help')
            .setDescription('Overview of available commands and important concepts.')
            .addFields(
                {
                    name: 'Commands',
                    value:
                        '• `/info [identifier] [reported] [resolved] [exclude_self_reported]` — View details about vulnerabilities and filter results.\n' +
                        '• `/report [vulnerability]` — Submit a full vulnerability report to the company. May lead to offers.\n' +
                        '• `/submitpoc [vulnerability]` — Submit a proof-of-concept for a vulnerability.\n' +
                        '• `/exploit start [identifier]` — Start exploiting an accessible, unresolved vulnerability. Generates passive income but has risks.\n' +
                        '• `/exploit stop [identifier]` — Stop exploiting a vulnerability.\n' +
                        '• `/exploit collect [identifier]` — Collect pending exploit earnings. There is a risk of being caught during collection.\n' +
                        '• `/exploit list` — View your active exploits and earnings.\n' +
                        '• `/trade user:<user>` — Propose a trade (vulnerabilities or money) with another user.\n' +
                        "• `/profile` — View your profile (reports made, money earned, reputation).\n"
                },
                {
                    name: 'Core Concepts',
                    value:
                        '• Reputation — Earned primarily by successful interactions (e.g., accepted offers). Higher reputation can improve company offers (bonus multipliers).\n' +
                        '• Exploitation — You may exploit vulnerabilities you have access to (typically those you reported or have been granted visibility to). Exploits generate passive income over time.\n' +
                        '• Risk & Penalties — Once a vulnerability is reported, there is an ongoing chance of detection, especially when you use `/exploit collect`. If you are caught, penalties may apply such as monetary fines and trust/reputation loss, and the exploit can be terminated. Staying cautious is advised.\n' +
                        '• Visibility — You can only interact with vulnerabilities that are unresolved and visible to you.\n' +
                        '• Offers — After submitting reports/POCs, companies may send offers after a short delay. Reputation and preferred vulnerability bonuses can increase payout.'
                }
            );

        await interaction.reply({ embeds: [embed], flags: 64 });
    }
};
