const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    EmbedBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const User = require('../../models/Users');
const Vulnerability = require('../../models/Vulnerabilities');
const Trade = require('../../models/Trades');

const slides=[
                {
                    title:"Welcome to HexaHive's Tutoral",
                    content: "This tutorial will guide you though different commands avalble and systems. Please note You must complete the tutorial inorder to fully interact with this bot"
                },

                {
                    title:"How do you get Volunerabilites?",
                    content:""
                },
                {
                    title:"Reporting Volunerabilites",
                    content: "W"
                },
                {
                    title:"Proof of Concepts",
                    content:""
                },
                {
                    title:"Rewards",
                    content:""
                },
                {
                    title:"Trading",
                    content:""
                },
                {
                    title:"Exploiting",
                    content:""
                },
                {
                    title:"Other Rules",
                    content: "W"
                },
            ]

module.export={
    data: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Tutorial and verification system for users to understand how to use the bot"),
    async execute(interaction){
        try{

        }
        catch(error){
            console.err(error)
        }
    }


}

async  function showSlide(interaction,userId,slideIndex){
        const progress = userProgress.get(userId);
        if(!progress) return;

        const currSlide = slide[slideIndex];
        const embed = new EmbedBuilder()
        .setTitle(slide.title)
        .setDescription(slide.content)
        .setFooter({
            text: `Slide ${slideIndex + 1}/${tutorialSlides.length} • Use buttons to navigate`
        });

        const buttons = []

        buttons.push(
            new ButtonBuilder()
                .setCustomId(`prev_${userId}`)
                .setLabel('◀ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(slideIndex === 0)
        );

        const isLastSlide = slideIndex === tutorialSlides.length - 1;
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`next_${userId}`)
                .setLabel(isLastSlide ? 'Complete and Verify' : 'Next ▶')
                .setStyle(isLastSlide ? ButtonStyle.Success : ButtonStyle.Primary)
        );

        const row = new ActionRowBuilder().addComponents(buttons);

        
}