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

function logError(context, error) {
    console.error(`[${context}]`, error?.stack || error);
}

async function safeInteractionReply(interaction, message) {
    const payload = typeof message === 'string'
        ? {content: message, ephemeral: true}
        : {ephemeral: true, ...message};

    try {
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload);
        } else {
            await interaction.reply(payload);
        }
    } catch (error) {
        logError('interaction error response failed', error);
    }
}

function executeEventSafely(event, args) {
    Promise.resolve(event.execute(...args, client)).catch(error => {
        logError(`event:${event.name}`, error);
        const interaction = args[0];
        if (interaction?.isRepliable?.()) {
            safeInteractionReply(interaction, 'An error occurred while processing that interaction.');
        }
    });
}

async function runStartupTask(name, task) {
    try {
        await task();
        return true;
    } catch (error) {
        logError(`startup:${name}`, error);
        return false;
    }
}

process.on('unhandledRejection', error => {
    logError('unhandledRejection', error);
});

process.on('uncaughtException', error => {
    logError('uncaughtException', error);
});


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
    try {
        const command = require(`./commands/${file}`);
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    } catch (error) {
        logError(`command load:${file}`, error);
    }
}

const eventsPath = path.join(__dirname, 'events');
const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    try {
        const event = require(filePath);

        if (event.once) {
            client.once(event.name, (...args) => executeEventSafely(event, args));
        } else {
            client.on(event.name, (...args) => executeEventSafely(event, args));
        }
        client.events.set(event.name, event);
    } catch (error) {
        logError(`event load:${file}`, error);
    }
}


const rest = new REST({version: '10'}).setToken(process.env.DISCORD_TOKEN);
connectDB().then(connected => {
    if (!connected) {
        console.warn('Bot will continue running, but database-backed commands may fail until MongoDB is available.');
    }
}).catch(error => logError('connectDB', error));

// Ensure a Discord user exists in the database; create if not, update last_active/name if yes
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

    // Keep each startup task isolated so one failure does not skip the rest.
    await runStartupTask('cache warmup', async () => {
        console.log('Warming up cache...');
        await Promise.all([
            cache.warmupCompanies(Company),
            cache.warmupPlatforms(Platform)
        ]);
        console.log('Cache warmup complete');
    });

    await runStartupTask('shop catalog', async () => {
        if (process.env.SHOP_ENABLED === 'true') {
            await loadShopItems();
        }
    });

    await runStartupTask('continuous mode', async () => {
        await continuousMode.initialize(client);
    });

    await runStartupTask('command registration', async () => {
        await rest.put(
            Routes.applicationCommands(process.env.DISCORD_APP_ID),
            {body: commands}
        );
        console.log("Registered Commands");
    });

    await runStartupTask('shop rotation', async () => {
        await initializeShopRotation();
    });

    setupGracefulShutdown();
});

client.on('messageCreate', async (msg) => {
    if (msg.author.bot) return;

    // Only update existing users' activity; do NOT auto-create here
    try {

        let existing = null;
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
    try {
        if (interaction.isChatInputCommand()) {
            const commandName = interaction.commandName;
            const command = client.commands.get(commandName);
            if (!command) return;

            // make sure a database user doc exists (and update last_active/time)
            let userDoc = null;
            try {
                userDoc = await ensureUserExists(interaction.user);
            } catch (e) {
                console.error('ensureUserExists error:', e);
            }

            // Gate commands: require verification except for /verify and /admin
            if (commandName !== 'verify' && commandName !== 'admin') {
                try {
                    if (!userDoc) {
                        return safeInteractionReply(interaction, {
                            content: 'You need to complete verification before using this command. Please run `/verify` first.',
                            ephemeral: true,
                        });
                    } else {
                        // Touch last_active for verified users (ensureUserExists already did this but double-check)
                        await User.updateOne({_id: userDoc._id}, {
                            $set: {
                                last_active: new Date(),
                                discord_name: interaction.user.tag,
                            },
                        });
                    }
                } catch (e) {
                    console.error('Verification gate error:', e);
                    return safeInteractionReply(interaction, 'Error verifying user status. Please try again.');
                }
            }

            if (
                userDoc &&
                userDoc.dashboard_channel_id &&
                commandName !== 'verify' &&
                commandName !== 'admin'
            ) {
                if (interaction.channelId !== userDoc.dashboard_channel_id) {
                    return safeInteractionReply(interaction, {
                        content: `Please use your personal dashboard channel <#${userDoc.dashboard_channel_id}> for commands.`,
                        ephemeral: true,
                    });
                }
            }

            // log the action before executing so we don't miss it if command errors
            try {
                const { logAction } = require('./utils/logUtils');
                let actionDesc = `/${commandName}`;

                function describeOpts(opts) {
                    if (!opts || !opts.length) return '';
                    const pieces = [];
                    for (const o of opts) {
                        // subcommand or group
                        if (o.type === 1 || o.type === 2) {
                            pieces.push(o.name);
                            if (o.options) {
                                const nested = describeOpts(o.options);
                                if (nested) pieces.push(nested);
                            }
                        } else {
                            pieces.push(`${o.name}:${o.value}`);
                        }
                    }
                    return pieces.join(' ');
                }
                const opts = interaction.options?.data || [];
                const optsDesc = describeOpts(opts);
                if (optsDesc) actionDesc += ' ' + optsDesc;

                if (userDoc && userDoc._id) {
                    await logAction(userDoc._id, actionDesc);
                }
            } catch (e) {
                console.error('Error logging action:', e);
            }

            try {
                await command.execute(interaction);
            } catch (err) {
                console.error(err);
                await safeInteractionReply(interaction, 'There was an error executing this command.');
            }
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
            console.log(`Component interaction: ${interaction.customId}`);
        }
    } catch (error) {
        logError('interactionCreate', error);
        if (interaction?.isRepliable?.()) {
            await safeInteractionReply(interaction, 'An error occurred while processing that interaction.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
    logError('discord login', error);
});
