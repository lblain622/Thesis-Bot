// bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits,Collection,REST, Routes } = require('discord.js');
const { connectDB } = require('../config/database');
const fs = require('fs');
const path = require('path');
const User = require('../models/Users');

//Some db interactions wont work based upon user privacy settings
//look iinto have the private dms function inside through different channels  (see how much of a delay it might cause in the sever when many ppl interact)

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

// Ensure a Discord user exists in the database; create if not, update last_active/name if yes
async function ensureUserExists(discordUser) {
    try {
        if (!discordUser) return;
        await User.findOneAndUpdate(
            { discord_id: discordUser.id },
            {
                $setOnInsert: {
                    discord_id: discordUser.id,
                },
                $set: {
                    discord_name: discordUser.tag,
                    last_active: new Date(),
                },
            },
            { upsert: true, new: true }
        );
    } catch (e) {
        // Non-fatal: bot should continue even if we fail to upsert user
        console.error('ensureUserExists error:', e);
    }
}

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

    // Add/Update user on any message usage (acts as a command usage tracker too)
    await ensureUserExists(msg.author);

    if (msg.content === '!ping') return msg.reply('pong');
});

client.on('interactionCreate', async interaction => {
    await ensureUserExists(interaction.user);

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
