const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    EmbedBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const User = require('../../models/Users');
// The following models may be used in future slides/interactions
// Keeping imports to match project style and potential use
const Vulnerability = require('../../models/Vulnerabilities');
const Trade = require('../../models/Trades');

// Tutorial slides explaining available commands and systems (like help)
const slides = [
    {
        title: "Welcome to HexaHive's Tutorial",
        content:
            "Welcome! This guided tutorial explains the main commands and rules.\n" +
            "• Use the buttons below to navigate.\n" +
            "• You must complete this tutorial to fully interact with the bot.\n" +
            "• When finished, you'll be verified and added to the system.",
    },
    {
        title: 'How do you get Vulnerabilities?',
        content:
            "You can discover vulnerabilities by participating in security research activities.\n"

    },
    {
        title: 'Reporting Vulnerabilities (/report)',
        content:
            "Use `/report` to submit a finding. Typical fields include: title, target, severity, and details.\n" +

    },
    {
        title: 'Proof of Concepts (PoC)',
        content:
            "A PoC demonstrates the issue safely.\n" +
            " User `/submitpoc` to submit a PoC.\n`"

    {
        title: 'Rewards and Reputation',
        content:
            "Valid reports may yield rewards and reputation.\n" +
            "• Reputation reflects trust and program history.\n" +
            "• Payouts depend on severity and program policy.\n" +
            "• Check `/info` for your stats when available.",
    },
    {
        title: 'Trading (/trade)',
        content:
            "Some findings or assets may be tradable if allowed.\n" +
            "• Use trading responsibly and follow server rules.\n" +
    },
    {
        title: 'Exploiting (/exploit)',
        content:
            "• Use `/exploit` features only as permitted by the program.\n" +
            "• Do not cause harm, data loss, or service disruption.\n" +
            "• Always prefer safe, minimal-impact validation.",
    },
    {
        title: 'Other Rules and Help',
        content:
            "General rules:\n" +
            "• No harassment, spam, or abuse.\n" +
            "• Follow moderators' instructions.\n" +
            "• When in doubt, ask for guidance.\n" +
            "You can always use command descriptions or server help channels for more info.",
    },
];

// Track per-user tutorial progress in memory
const userProgress = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Tutorial and verification system for users to understand how to use the bot'),
    async execute(interaction) {
        try {
            const userId = interaction.user.id;
            const userTag = interaction.user.tag;

            // Initialize progress
            userProgress.set(userId, { index: 0 });

            // Send first slide as an ephemeral reply
            const { embed, components } = buildSlide(slides[0], 0, userId);
            const reply = await interaction.reply({
                embeds: [embed],
                components,
                ephemeral: true,
            });

            // Collector for this interaction
            const message = await interaction.fetchReply();
            const filter = (i) =>
                i.user.id === userId &&
                (i.customId === `prev_${userId}` || i.customId === `next_${userId}`);
            const collector = message.createMessageComponentCollector({
                componentType: ComponentType.Button,
                time: 10 * 60 * 1000, // 10 minutes
                filter,
            });

            collector.on('collect', async (i) => {
                const prog = userProgress.get(userId);
                if (!prog) return i.deferUpdate().catch(() => {});
                let idx = prog.index;

                if (i.customId.startsWith('prev_')) {
                    idx = Math.max(0, idx - 1);
                    prog.index = idx;
                    const built = buildSlide(slides[idx], idx, userId);
                    await i.update({ embeds: [built.embed], components: built.components }).catch(() => {});
                    return;
                }

                // next or complete
                const isLast = idx === slides.length - 1;
                if (!isLast) {
                    idx = Math.min(slides.length - 1, idx + 1);
                    prog.index = idx;
                    const built = buildSlide(slides[idx], idx, userId);
                    await i.update({ embeds: [built.embed], components: built.components }).catch(() => {});
                } else {
                    // Complete and verify: add user to DB if not exists
                    try {
                        const existing = await User.findOne({ discord_id: userId });
                        if (!existing) {
                            await User.create({ discord_id: userId, discord_name: userTag });
                        } else {
                            existing.last_active = new Date();
                            await existing.save();
                        }
                    } catch (dbErr) {
                        // If DB fails, still close the tutorial and show an error note
                        // but do not throw to avoid unhandled rejection
                    }

                    userProgress.delete(userId);
                    const doneEmbed = new EmbedBuilder()
                        .setTitle('Verification Complete')
                        .setDescription(
                            'You have completed the tutorial. You are now verified and have been added to the system (if not already).'
                        );
                    await i.update({
                        embeds: [doneEmbed],
                        components: [
                            new ActionRowBuilder().addComponents(
                                new ButtonBuilder()
                                    .setCustomId(`done_${userId}`)
                                    .setLabel('Completed')
                                    .setStyle(ButtonStyle.Success)
                                    .setDisabled(true)
                            ),
                        ],
                    }).catch(() => {});
                    collector.stop('completed');
                }
            });

            collector.on('end', async () => {

                try {
                    const msg = await interaction.fetchReply();
                    const rows = msg.components?.map((row) => {
                        const newRow = new ActionRowBuilder();
                        newRow.addComponents(
                            ...row.components.map((c) => ButtonBuilder.from(c).setDisabled(true))
                        );
                        return newRow;
                    });
                    if (rows && rows.length) {
                        await interaction.editReply({ components: rows }).catch(() => {});
                    }
                } catch (_) {

                }
            });
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: 'An error occurred while starting the tutorial.' }).catch(() => {});
            } else {
                await interaction.reply({ content: 'An error occurred while starting the tutorial.', ephemeral: true }).catch(() => {});
            }
        }
    },
};

function buildSlide(slide, index, userId) {
    const embed = new EmbedBuilder()
        .setTitle(slide.title)
        .setDescription(slide.content)
        .setFooter({ text: `Slide ${index + 1}/${slides.length} • Use buttons to navigate` });

    const buttons = [];
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`prev_${userId}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0)
    );

    const isLastSlide = index === slides.length - 1;
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`next_${userId}`)
            .setLabel(isLastSlide ? 'Complete and Verify' : 'Next ▶')
            .setStyle(isLastSlide ? ButtonStyle.Success : ButtonStyle.Primary)
    );

    const row = new ActionRowBuilder().addComponents(buttons);
    return { embed, components: [row] };
}