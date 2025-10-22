require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { connectDB } = require('../config/database');


const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

connectDB();

client.once('ready', () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);
});

client.login(process.env.BOT_TOKEN);