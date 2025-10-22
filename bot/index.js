// bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits,Collection,REST, Routes } = require('discord.js');
const { connectDB } = require('../config/database');
const fs = require('fs');
const path = require('path');
require('../models/Users');


const client = new Client({
    intents:
        [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
        ]
});

client.commands = new Collection();
client.events = new Collection();

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
  commands.push(command.data.toJSON());
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);

    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args, client));
    } else {
        client.on(event.name, (...args) => event.execute(...args, client));
    }
    client.events.set(event.name, event);
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
