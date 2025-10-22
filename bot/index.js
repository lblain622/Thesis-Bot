// bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits,Collection,REST, Routes } = require('discord.js');
const { connectDB } = require('../config/database');
const fs = require('fs');
const path = require('path');

// require models so they register with mongoose
const Users = require('../models/Users');
const Company = require('../models/Company');
const Platform = require('../models/Platform');
const Reports = require('../models/Reports');
const CompanyOffers = require('../models/CompanyOffers');
const Vulnerabilities = require('../models/Volunerabilies');
const BountyTiers = require('../models/BountyTiers');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();
const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
connectDB();

client.once('clientReady', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    try {
        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            { body: commands }
        );
        console.log("Registered Commands");
    } catch (err) {
        console.error('Error with commands:', err);
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    if (msg.content === '!ping') return msg.reply('pong');

    if (msg.content === '!dbtest') {

        const platforms = await Platform.find({}).limit(10);
        const companies = await Company.find({}).limit(10);
        const pList = platforms.map(p => `${p.name} (${p._id})`).join('\n') || 'none';
        const cList = companies.map(c => `${c.name} (${c._id})`).join('\n') || 'none';
        return msg.reply(`Platforms:\n${pList}\n\nCompanies:\n${cList}`);
    }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(err);
            await interaction.reply({
                content: 'There was an error executing this command.',
                ephemeral: true,
            });
        }
    }
    else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        console.log(`Component interaction: ${interaction.customId}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
