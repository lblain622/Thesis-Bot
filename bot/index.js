// bot/index.js
require('dotenv').config();
const {Client, GatewayIntentBits, Collection, REST, Routes} = require('discord.js');
const {connectDB} = require('../config/database');
const fs = require('fs');
const path = require('path');
const User = require('../models/Users');

const continuousMode = require('./utils/continuousMode');
const cache = require('./utils/cache');
const {loadShopItems} = require('./utils/loadShopItems');
const {initializeShopRotation, cleanupShopRotation} = require('./utils/shopRotation');
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


const rest = new REST({version: '10'}).setToken(process.env.DISCORD_TOKEN);
connectDB();

// Ensure a Discord user exists in the database; create if not, update last_active/name if yes
// Now with caching to reduce DB load
async function ensureUserExists(discordUser) {
    try {
        if (!discordUser) return null;



        // Update in database
        const user = await User.findOneAndUpdate(
            {discord_id: discordUser.id},
            {
                $setOnInsert: {
                    discord_id: discordUser.id,
                },
                $set: {
                    discord_name: discordUser.tag,
                    last_active: new Date(),
                },
            },
            {upsert: true, new: true}
        ).lean();

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
                }
                // Cleanup shop rotation
                if (typeof cleanupShopRotation === 'function') {
                    cleanupShopRotation();
                    console.log('Cleaned up shop rotation timers');
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

        await continuousMode.initialize(client);

        const data = await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            {body: commands}
        );
        // Initialize Shop rotation

        await initializeShopRotation();

        setupGracefulShutdown();
        console.log("Registered Commands");
    } catch (err) {
        console.error('Error with commands:', err);
    }
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    // Only update existing users' activity; do NOT auto-create here
    try {
        const cached = cache.getUser(msg.author.id);
        let existing = cached;
        if (!existing) {
            existing = await User.findOne({discord_id: msg.author.id}).lean();
            if (existing) cache.setUser(msg.author.id, existing);
        }
        if (existing) {
            await User.updateOne(
                {_id: existing._id},
                {$set: {last_active: new Date(), discord_name: msg.author.tag}}
            );
        }
    } catch (_) {
    }

    if (msg.content === '!ping') return msg.reply('pong');
});

client.on('interactionCreate', async interaction => {
    if (interaction.isChatInputCommand()) {
        const commandName = interaction.commandName;
        const command = client.commands.get(commandName);
        if (!command) return;

        // Gate commands: require verification except for /verify and /admin
        if (commandName !== 'verify' && commandName !== 'admin') {
            try {
                const cached = cache.getUser(interaction.user.id);
                let userDoc = cached;
                if (!userDoc) {
                    userDoc = await User.findOne({discord_id: interaction.user.id}).lean();
                    if (userDoc) cache.setUser(interaction.user.id, userDoc);
                }
                if (!userDoc) {
                    return interaction.reply({
                        content: 'You need to complete verification before using this command. Please run `/verify` first.',
                        ephemeral: true,
                    });
                } else {
                    // Touch last_active for verified users
                    await User.updateOne({_id: userDoc._id}, {
                        $set: {
                            last_active: new Date(),
                            discord_name: interaction.user.tag
                        }
                    });
                }
            } catch (e) {
                console.error('Verification gate error:', e);
                return interaction.reply({content: 'Error verifying user status. Please try again.', ephemeral: true});
            }
        }

        try {
            await command.execute(interaction);
        } catch (err) {
            console.error(err);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({content: 'There was an error executing this command.', ephemeral: true});
            } else {
                await interaction.reply({
                    content: 'There was an error executing this command.',
                    ephemeral: true,
                });
            }
        }
    } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
        console.log(`Component interaction: ${interaction.customId}`);
    }
});

client.login(process.env.DISCORD_TOKEN);
