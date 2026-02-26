const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    EmbedBuilder,
    ButtonStyle,
    ComponentType,
    ChannelType,
    PermissionFlagsBits,
} = require('discord.js');
const User = require('../../models/Users');
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
        title: 'Searching for Vulnerabilities (/search)',
        content:
            "Before you can report anything, you need to find it!\n" +
            "• Use `/search` to scan the world for active vulnerabilities.\n" +
            "• Items like **Scout Drones** or **Signal Boosters** can help you find more or reveal more details.\n",
    },
    {
        title: 'Reporting Vulnerabilities (/report)',
        content:
            "Once you've found a vulnerability via `/search`, it's time to report it.\n" +
            "• Use `/report` to submit your findings to the affected company.\n" +
            "• You can select a company and a vulnerability you've discovered from the menus.\n" +
            "• Companies on different platforms  may offer different reward structures.",
    },
    {
        title: 'Proof of Concepts (/poc)',
        content:
            "Sometimes a simple report isn't enough. A Proof of Concept (PoC) proves the impact.\n" +
            "• Use `/poc` to develop and collect evidence for a vulnerability.\n" +
            "• Successful PoCs can increase your rewards and reputation.",
    },
    {
        title: 'Checking Vulnerability Info (/info)',
        content:
            "Need to see the details of what you've found?\n" +
            "• Use `/info` to view technical details, reported status, and expiration times for vulnerabilities you have access to.\n" +
            "• You can filter by reported or resolved status to keep track of your work.",
    },
    {
        title: 'Exploiting for Profit (/exploit)',
        content:
            "If you're feeling risky, you can exploit vulnerabilities for passive income.\n" +
            "• Use `/exploit start` to begin earning money every minute from an unpatched bug.\n" +
            "• Use `/exploit collect` to gather your earnings—but beware, there's a risk of being caught!\n" +
            "• If caught, you'll face heavy fines. Use `/exploit stop` to cease operations .",
    },
//    {
//        title: 'Your Profile and Stats (/profile)',
//        content:
//            "Keep track of your progress as a security researcher.\n" +
//            "• Use `/profile` to view your total reports, balance, reputation points, and a preview of your inventory.\n" +
//            "• Your balance and reputation are key to your standing in HexaHive.",
//    },
//    {
//        title: 'The Shop (/shop)',
//        content:
//            "Spend your hard-earned money to boost your capabilities.\n" +
//            "• Use `/shop list` to see available items like tools, merch, and consumables.\n" +
//            "• Use `/shop buy` to purchase items that can double rewards, help discovery, or provide company-specific bonuses.\n" +
//            "• Use `/shop inventory` to see everything you own.",
//    },
//    {
//        title: 'Trading with Others (/trade)',
//        content:
//            "Collaborate or barter with other researchers.\n" +
//            "• Use `/trade @user` to propose a swap of vulnerabilities or money.\n" +
//            "• Both parties must confirm the trade for it to be completed.",
//    },
    {
        title: 'Getting Help (/help)',
        content:
            "Forgotten a command? Need a quick refresher? See other available command?\n" +
            "• Use `/help` for a general overview of all available commands.\n" +
            "• This tutorial can always be restarted with `/verify` if you need a deeper dive.",
    },
    {
        title: 'Final Rules',
        content:
            "General rules for the community:\n" +
            "• No harassment, spam, or abuse.\n" +
            "• Follow moderators' instructions.\n" +
            "• When in doubt, ask for guidance in the support channels.\n\n" +
            "Click 'Complete and Verify' below to finish your training!",
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
            userProgress.set(userId, {index: 0, lastSlideAt: Date.now()});

            // Send first slide as an ephemeral reply
            const {embed, components} = buildSlide(slides[0], 0, userId, true);
            const reply = await interaction.reply({
                embeds: [embed],
                components,
                ephemeral: true,
            });

            // Re-enable the next button after 5 seconds
            setTimeout(async () => {
                const prog = userProgress.get(userId);
                if (prog && prog.index === 0) {
                    const {
                        embed: updatedEmbed,
                        components: updatedComponents
                    } = buildSlide(slides[0], 0, userId, false);
                    await interaction.editReply({
                        embeds: [updatedEmbed],
                        components: updatedComponents,
                    }).catch(() => {
                    });
                }
            }, 5000);

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
                if (!prog) return i.deferUpdate().catch(() => {
                });

                const now = Date.now();
                const elapsed = now - prog.lastSlideAt;

                if (i.customId.startsWith('next_') && elapsed < 5000) {
                    return i.reply({
                        content: `Please wait ${Math.ceil((5000 - elapsed) / 1000)} more seconds before proceeding.`,
                        ephemeral: true
                    });
                }

                let idx = prog.index;

                if (i.customId.startsWith('prev_')) {
                    idx = Math.max(0, idx - 1);
                    prog.index = idx;
                    prog.lastSlideAt = now - 5000; // Allow immediate "Next" after going back
                    const built = buildSlide(slides[idx], idx, userId, false);
                    await i.update({embeds: [built.embed], components: built.components}).catch(() => {
                    });
                    return;
                }

                // next or complete
                const isLast = idx === slides.length - 1;
                if (!isLast) {
                    idx = Math.min(slides.length - 1, idx + 1);
                    prog.index = idx;
                    prog.lastSlideAt = now;
                    const built = buildSlide(slides[idx], idx, userId, true);
                    await i.update({embeds: [built.embed], components: built.components}).catch(() => {
                    });

                    // Re-enable button after 5s
                    setTimeout(async () => {
                        const currentProg = userProgress.get(userId);
                        if (currentProg && currentProg.index === idx) {
                            const updated = buildSlide(slides[idx], idx, userId, false);
                            await interaction.editReply({
                                embeds: [updated.embed],
                                components: updated.components
                            }).catch(() => {
                            });
                        }
                    }, 5000);
                } else {
                    // Complete and verify: add user to DB if not exists, create dashboard channel if needed
                    try {
                        let existing = await User.findOne({discord_id: userId});
                        if (!existing) {
                            existing = await User.create({discord_id: userId, discord_name: userTag});
                            const role = await message.guild.roles.cache.find(r=> r.name==="playtest");
                            const member = await message.guild.members.fetch(userId);
                            await member.roles.add(role);
                            console.log(`Added role ${role.name} to ${member.user.tag}`);
                        } else {
                            existing.last_active = new Date();
                            await existing.save();
                        }

                        // if user doesn't already have a dashboard channel, create one
                        if (!existing.dashboard_channel_id && interaction.guild) {
                            // find or create category
                            let category = interaction.guild.channels.cache.find(c =>
                                c.name === 'dashboard' && c.type === ChannelType.GuildCategory);
                            if (!category) {
                                category = await interaction.guild.channels.create({
                                    name: 'dashboard',
                                    type: ChannelType.GuildCategory,
                                    permissionOverwrites: [
                                        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                                    ],
                                });
                            }

                            // make unique channel name
                            let chanName = `dashboard-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9\-]/g, '').slice(0, 80);
                            // ensure no duplicate
                            if (interaction.guild.channels.cache.some(c => c.name === chanName)) {
                                chanName += `-${userId.slice(-4)}`;
                            }

                            const privateChannel = await interaction.guild.channels.create({
                                name: chanName,
                                type: ChannelType.GuildText,
                                parent: category.id,
                                permissionOverwrites: [
                                    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                                    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                                ],
                            });

                            existing.dashboard_channel_id = privateChannel.id;
                            await existing.save();
                        }
                    } catch (dbErr) {
                        // If DB fails, still close the tutorial and show an error note
                        // but do not throw to avoid unhandled rejection
                    }

                    userProgress.delete(userId);
                    let description = 'You have completed the tutorial. You are now verified and have been added to the system (if not already).';
                    // if we stored channel id, mention it
                    const fresh = await User.findOne({discord_id: userId});
                    if (fresh && fresh.dashboard_channel_id) {
                        description += `\n\nYour personal dashboard channel has been created: <#${fresh.dashboard_channel_id}>. ` +
                            'Please use that channel to issue commands going forward.';
                    }

                    const doneEmbed = new EmbedBuilder()
                        .setTitle('Verification Complete')
                        .setDescription(description);
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
                    }).catch(() => {
                    });
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
                        await interaction.editReply({components: rows}).catch(() => {
                        });
                    }
                } catch (_) {

                }
            });
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({content: 'An error occurred while starting the tutorial.'}).catch(() => {
                });
            } else {
                await interaction.reply({
                    content: 'An error occurred while starting the tutorial.',
                    ephemeral: true
                }).catch(() => {
                });
            }
        }
    },
};

function buildSlide(slide, index, userId, nextDisabled = false) {
    const embed = new EmbedBuilder()
        .setTitle(slide.title)
        .setDescription(slide.content)
        .setFooter({text: `Slide ${index + 1}/${slides.length} • Use buttons to navigate`});

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
            .setDisabled(nextDisabled)
    );

    const row = new ActionRowBuilder().addComponents(buttons);
    return {embed, components: [row]};
}