const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
} = require('discord.js');
const User = require('../../models/Users');
const Vulnerability = require('../../models/Vulnerabilities');
const Trade = require('../../models/Trades');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('trade')
        .setDescription('Propose a trade of vulnerabilities, items, or money')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The user to trade with')
                .setRequired(true)
        ),

    async execute(interaction) {
        await interaction.deferReply({flags: 64});

        try {
            const targetDiscordUser = interaction.options.getUser('user');

            if (targetDiscordUser.bot) {
                return interaction.editReply({content: 'You cannot trade with bots!', flags: 64});
            }

            if (targetDiscordUser.id === interaction.user.id) {
                return interaction.editReply({content: 'You cannot trade with yourself!', flags: 64});
            }

            const givingUser = await User.findOne({discord_id: interaction.user.id});
            const receivingUser = await User.findOne({discord_id: targetDiscordUser.id});

            if (!givingUser || !receivingUser) {
                return interaction.editReply({content: 'One or both users were not found in the database.', flags: 64});
            }

            const givingType = await selectAssetType(interaction, 'What do you want to offer?');
            if (!givingType) return;

            const givingValue = await selectOwnedAsset(interaction, givingUser, givingType, 'Choose what you are offering:');
            if (!givingValue) return;

            const requestedType = await selectAssetType(interaction, 'What would you like in return?');
            if (!requestedType) return;

            let requestedValue = null;
            if (requestedType === 'money') {
                requestedValue = await enterAmount(interaction, null, 'How much money would you like in return?');
                if (!requestedValue) return;
            }

            const preview = await formatTradeOffer({
                givingType,
                givingValue,
                requestedType,
                requestedValue,
                receivingType: requestedType,
                receivingValue: requestedValue
            });

            const confirmed = await confirmPrompt(
                interaction,
                `**Trade proposal for ${targetDiscordUser.username}**\n\n${preview}\n\nSend this trade proposal?`,
                'Send Proposal'
            );
            if (!confirmed) return;

            const trade = await Trade.create({
                giving_user_id: givingUser._id,
                receiving_user_id: receivingUser._id,
                gu_item_type: givingType,
                ru_item_type: requestedType,
                gu_value: givingValue,
                ru_value: requestedValue || null,
                status: 'pending',
                created_at: new Date(),
                expires_at: new Date(Date.now() + 10 * 60 * 1000),
            });

            const {notifyUser} = require('../utils/logUtils');
            await notifyUser(interaction.client, receivingUser._id, {
                content:
                    `**Trade Proposal from ${interaction.user.username}**\n\n${preview}\n\n` +
                    `Select what you will trade, then both players will confirm the final exchange.`,
                components: [
                    new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`trade_accept_${trade._id}`)
                            .setLabel('Choose My Side')
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(`trade_reject_${trade._id}`)
                            .setLabel('Decline')
                            .setStyle(ButtonStyle.Danger)
                    )
                ]
            });

            await interaction.editReply({
                content: `Trade proposal sent to ${targetDiscordUser.username}.`,
                components: []
            });
        } catch (err) {
            console.error(err);
            await interaction.editReply({
                content: 'An error occurred while creating the trade.',
                components: [],
                flags: 64
            });
        }
    },
};

async function selectAssetType(interaction, promptText) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_trade_type')
        .setPlaceholder('Select an asset type')
        .addOptions([
            {label: 'Vulnerability', value: 'vulnerability', description: 'Trade vulnerability intel'},
            {label: 'Item', value: 'item', description: 'Trade an inventory item'},
            {label: 'Money', value: 'money', description: 'Trade money'}
        ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);
    const message = await interaction.editReply({
        content: promptText,
        components: [row],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_trade_type', 120000);
    if (!response) return null;

    await response.update({content: `Selected: ${response.values[0]}`, components: []});
    return response.values[0];
}

async function selectOwnedAsset(interaction, user, type, promptText) {
    if (type === 'money') {
        return enterAmount(interaction, getBalance(user), promptText);
    }

    if (type === 'vulnerability') {
        return selectVulnerability(interaction, user._id, promptText);
    }

    return selectItem(interaction, user._id, promptText);
}

async function selectVulnerability(interaction, userId, promptText) {
    const vulnerabilities = await Vulnerability.find({
        isResolved: false,
        'visibility.allowedUsers': userId
    }).lean();

    if (!vulnerabilities.length) {
        await interaction.editReply({content: 'You have no vulnerabilities available to trade.', components: []});
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_trade_vulnerability')
        .setPlaceholder('Select a vulnerability')
        .addOptions(
            vulnerabilities.slice(0, 25).map(v => ({
                label: v.vuln_identifier,
                description: v.volun_type?.slice(0, 100) || 'Vulnerability intel',
                value: v._id.toString()
            }))
        );

    const message = await interaction.editReply({
        content: promptText,
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_trade_vulnerability', 120000);
    if (!response) return null;

    await response.update({content: 'Vulnerability selected.', components: []});
    return response.values[0];
}

async function selectItem(interaction, userId, promptText) {
    const user = await User.findById(userId).populate('inventory.item_id').populate('inventory.company_id');
    const entries = (user?.inventory || []).filter(e => e.item_id && (e.qty || 0) > 0);

    if (!entries.length) {
        await interaction.editReply({content: 'You have no items available to trade.', components: []});
        return null;
    }

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('select_trade_item')
        .setPlaceholder('Select an item')
        .addOptions(
            entries.slice(0, 25).map((entry, index) => ({
                label: entry.item_id.name?.slice(0, 100) || 'Item',
                description: `${entry.company_id?.name ? `${entry.company_id.name} - ` : ''}Qty: ${entry.qty}`.slice(0, 100),
                value: String(index)
            }))
        );

    const message = await interaction.editReply({
        content: promptText,
        components: [new ActionRowBuilder().addComponents(selectMenu)],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.StringSelect, 'select_trade_item', 120000);
    if (!response) return null;

    const entry = entries[Number(response.values[0])];
    await response.update({content: 'Item selected.', components: []});
    return {
        item_id: entry.item_id._id.toString(),
        company_id: entry.company_id?._id?.toString() || null,
        qty: 1
    };
}

async function enterAmount(interaction, maxAmount, promptText) {
    const balanceLine = maxAmount == null ? '' : `\n**Available balance:** $${maxAmount}`;
    await interaction.editReply({
        content: `${promptText}${balanceLine}\n\nPlease type the amount in chat:`,
        components: []
    });

    const collected = await interaction.channel.awaitMessages({
        filter: msg => msg.author.id === interaction.user.id,
        max: 1,
        time: 120000
    });

    if (!collected.size) {
        await interaction.followUp({content: 'Trade timed out.', flags: 64});
        return null;
    }

    const amount = Math.floor(Number(collected.first().content));
    await collected.first().delete().catch(() => {});

    if (!Number.isFinite(amount) || amount <= 0) {
        await interaction.followUp({content: 'Invalid amount.', flags: 64});
        return null;
    }

    if (maxAmount != null && amount > maxAmount) {
        await interaction.followUp({content: 'You do not have enough money.', flags: 64});
        return null;
    }

    return amount;
}

async function confirmPrompt(interaction, content, confirmLabel) {
    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('trade_confirm')
            .setLabel(confirmLabel)
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId('trade_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger)
    );

    const message = await interaction.editReply({
        content,
        components: [buttons],
        fetchReply: true
    });

    const response = await waitForComponent(message, interaction.user.id, ComponentType.Button, ['trade_confirm', 'trade_cancel'], 120000);
    if (!response || response.customId === 'trade_cancel') {
        await interaction.editReply({content: 'Trade cancelled.', components: []});
        return false;
    }

    await response.update({content: 'Creating trade proposal...', components: []});
    return true;
}

async function formatTradeOffer(trade) {
    const giving = await formatAsset(trade.givingType, trade.givingValue);
    const requested = trade.requestedType === 'money'
        ? await formatAsset('money', trade.requestedValue)
        : `a ${trade.requestedType}`;
    const receiving = trade.receivingValue
        ? await formatAsset(trade.receivingType, trade.receivingValue)
        : requested;

    return `**Player 1 offers:** ${giving}\n**Player 1 wants:** ${requested}\n**Player 2 gives:** ${receiving}`;
}

async function formatAsset(type, value) {
    if (type === 'money') return `$${value}`;

    if (type === 'vulnerability') {
        const vuln = await Vulnerability.findById(value).lean();
        return vuln ? `${vuln.vuln_identifier}` : 'unknown vulnerability';
    }

    const userWithItem = await User.findOne({
        'inventory.item_id': value.item_id,
        ...(value.company_id ? {'inventory.company_id': value.company_id} : {})
    }).populate('inventory.item_id').populate('inventory.company_id').lean();
    const entry = (userWithItem?.inventory || []).find(e =>
        String(e.item_id?._id || e.item_id) === String(value.item_id) &&
        String(e.company_id?._id || e.company_id || '') === String(value.company_id || '')
    );
    const company = entry?.company_id?.name ? ` (${entry.company_id.name})` : '';
    return `${entry?.item_id?.name || 'item'}${company}`;
}

function getBalance(user) {
    return Number(user.balance ?? user.money_earned ?? 0);
}

async function waitForComponent(message, userId, componentType, customIds, time) {
    try {
        return await message.awaitMessageComponent({
            componentType,
            filter: i => {
                const correctUser = i.user.id === userId;
                const correctComponent = Array.isArray(customIds)
                    ? customIds.includes(i.customId)
                    : i.customId === customIds;
                return correctUser && correctComponent;
            },
            time
        });
    } catch (error) {
        console.error('Component wait error:', error);
        await message.edit({content: 'Selection timed out.', components: []}).catch(() => {});
        return null;
    }
}
