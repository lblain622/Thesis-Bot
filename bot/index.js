// bot/index.js
require('dotenv').config();
const { Client, GatewayIntentBits,Collection,REST, Routes } = require('discord.js');
const { connectDB } = require('../config/database');
const fs = require('fs');
const path = require('path');
const User = require('../models/Users');
const roundSystem = require('./utils/roundSystem');
const continuousMode = require('./utils/continuousMode');
const cache = require('./utils/cache');
const { loadShopItems } = require('./utils/loadShopItems');
const Company = require('../models/Company');
const Platform = require('../models/Platform');

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
// Now with caching to reduce DB load
async function ensureUserExists(discordUser) {
    try {
        if (!discordUser) return null;

        // Check cache first
        const cachedUser = cache.getUser(discordUser.id);
        if (cachedUser) {
            // Only update last_active if more than 1 minute has passed
            const oneMinuteAgo = Date.now() - 60000;
            if (cachedUser.last_active && new Date(cachedUser.last_active).getTime() > oneMinuteAgo) {
                return cachedUser;
            }
        }

        // Update in database
        const user = await User.findOneAndUpdate(
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
        ).lean();

        // Cache the result
        cache.setUser(discordUser.id, user);
        return user;
    } catch (e) {
        // Non-fatal: bot should continue even if we fail to upsert user
        console.error('ensureUserExists error:', e);
        return null;
    }
}
function setupGracefulShutdown() {
    const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    shutdownSignals.forEach(signal => {
        process.on(signal, async () => {
            console.log(`\n${signal} received. Shutting down gracefully...`);

            try {
                // Clean up timers (round or continuous)
                if (process.env.CONTINUOUS_MODE === 'true') {
                    if (typeof continuousMode.cleanupTimers === 'function') {
                        continuousMode.cleanupTimers();
                        console.log('Cleaned up continuous mode timers');
                    }
                } else if (typeof roundSystem.cleanupTimers === 'function') {
                    roundSystem.cleanupTimers();
                    console.log('Cleaned up round system timers');
                }

                // End any active round properly
                if (process.env.CONTINUOUS_MODE !== 'true') {
                    const activeRound = await roundSystem.getCurrentRound();
                    if (activeRound) {
                        console.log(`Ending active round ${activeRound.round_number} before shutdown...`);
                        try {
                            await roundSystem.endRound(client);
                        } catch (e) {
                            console.error('Error ending round on shutdown:', e);
                        }
                    }
                }

                // Destroy Discord client
                if (client && !client.destroyed) {
                    client.destroy();
                    console.log('Discord client destroyed');
                }

                console.log('Shutdown complete.');
                process.exit(0);
            } catch (error) {
                console.error('Error during graceful shutdown:', error);
                process.exit(1);
            }
        });
    });
}

client.once('clientReady', async () => {
    console.log(`🤖 Logged in as ${client.user.tag}`);

    try {
        // Warmup cache with shared data
        console.log('Warming up cache...');
        await Promise.all([
            cache.warmupCompanies(Company),
            cache.warmupPlatforms(Platform)
        ]);
        console.log('Cache warmup complete');

        // Load Shop catalog if enabled
        if (process.env.SHOP_ENABLED === 'true') {
            await loadShopItems();
        }

        // Initialize game mode
        if (process.env.CONTINUOUS_MODE === 'true') {
            // Continuous mode (no rounds)
            await continuousMode.initialize(client);
        } else {
            // Round-based mode (legacy)
            roundSystem.cleanupTimers();
            await roundSystem.enableAutoRun();
            await roundSystem.initializeRoundSystem(client);
            await roundSystem.recoverRoundSystem(client);
        }

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            { body: commands }
        );
        setupGracefulShutdown();
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
