const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ComponentType,
} = require('discord.js');
const Items = require('../../models/Items');
const Users = require('../../models/Users');
const Company = require('../../models/Company');
const ItemStock = require('../../models/ItemStock');
const ShopRotation = require('../../models/ShopRotation');
const {getActiveRotation} = require('../utils/shopRotation');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('shop')
        .setDescription('Shop for items that boost your gameplay')
        .addSubcommand(sc => sc
            .setName('list')
            .setDescription('List available items')
            .addStringOption(o => o
                .setName('type')
                .setDescription('Filter by item type')
                .addChoices(
                    {name: 'Merch', value: 'merch'},
                    {name: 'Tool', value: 'tool'},
                )
                .setRequired(false)
            )
        )
        .addSubcommand(sc => sc
            .setName('buy')
            .setDescription('Buy an item')
            .addStringOption(o => o.setName('item_key').setDescription('Catalog key (e.g., merchant_hat)').setRequired(true))
            .addStringOption(o => o.setName('company').setDescription('Company name (for company-scoped merch)').setRequired(false))
            .addIntegerOption(o => o.setName('qty').setDescription('Quantity (for stackable items)').setRequired(false))
        )
    ,

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        if (sub === 'list') return listItems(interaction);
        if (sub === 'buy') return buyItem(interaction);
        return interaction.reply({content: 'Unknown subcommand.', flags: 64});
    }
};

async function listItems(interaction) {
    await interaction.deferReply({flags: 64});
    const type = interaction.options.getString('type');

    let items = [];
    let title = 'Shop Catalog';
    let footer = null;
    if (process.env.SHOP_ROTATE_ENABLED === 'true') {
        const rotation = await getActiveRotation();
        const now = new Date();
        const remainingMs = Math.max(0, new Date(rotation.active_until).getTime() - now.getTime());
        const m = Math.floor(remainingMs / 60000);
        const s = Math.floor((remainingMs % 60000) / 1000);
        footer = `Resets in ${m}m ${s}s`;
        const ids = rotation.item_ids || [];
        const q = {_id: {$in: ids}, enabled: true};
        if (type) q.type = type;
        items = await Items.find(q).sort({price: 1}).lean();
        title = 'Shop — Rotating Selection (4 items)';
    } else {
        const query = {enabled: true};
        if (type) query.type = type;
        items = await Items.find(query).sort({price: 1}).limit(4).lean();
        title = 'Shop Catalog (4 items)';
    }

    if (!items.length) return interaction.editReply({content: 'No items available right now.'});
    const embed = new EmbedBuilder().setTitle(title).setColor('#3BA55D');
    for (const it of items) {
        const scope = it.companyScoped ? ' (company-specific)' : '';
        // Daily stock remaining (if enabled)
        let stockStr = '';
        if (process.env.SHOP_ROTATE_ENABLED === 'true') {
            const dayKey = getDayKey();
            const st = await ItemStock.findOne({item_id: it._id, dayKey}).lean();
            const cap = st?.cap ?? Number(process.env.SHOP_DAILY_CAP_DEFAULT || 50);
            const sold = st?.sold || 0;
            const remain = Math.max(0, cap - sold);
            stockStr = `\nStock remaining today: ${remain}/${cap}`;
        }
        embed.addFields({
            name: `${it.name} — $${it.price}${scope}`,
            value: `Key: ${it.key}\nType: ${it.type}${it.stackable ? ' (stackable)' : ''}\n${it.description || ''}${stockStr}`,
            inline: false
        });
    }
    if (footer) embed.setFooter({text: footer});
    return interaction.editReply({embeds: [embed]});
}

async function buyItem(interaction) {
    await interaction.deferReply({flags: 64});
    try {
        const itemKey = interaction.options.getString('item_key');
        const qtyArg = interaction.options.getInteger('qty') || 1;
        const companyName = interaction.options.getString('company');
        const discordId = interaction.user.id;

        const user = await Users.findOne({discord_id: discordId});
        if (!user) return interaction.editReply({content: 'User not found.'});

        const item = await Items.findOne({key: itemKey, enabled: true});
        if (!item) return interaction.editReply({content: `Item with key "${itemKey}" is not available.`});

        // Pre-calc desired quantity for stock and cost
        let qty = item.stackable ? Math.max(1, qtyArg) : 1;

        let selectedCompany = null;
        let companyId = null;
        if (item.companyScoped) {
            selectedCompany = companyName
                ? await Company.findOne({name: new RegExp(`^${escapeRegExp(companyName)}$`, 'i')})
                : await promptForCompany(interaction, item);
            if (!selectedCompany) {
                const missingMsg = companyName
                    ? `Company "${companyName}" not found.`
                    : 'Purchase cancelled. No company was selected.';
                return interaction.editReply({content: missingMsg, components: []});
            }
            companyId = selectedCompany._id;
            // Non-stackable merch: prevent duplicates for same company
            if (!item.stackable) {
                const already = (user.inventory || []).some(e => String(e.item_id) === String(item._id) && String(e.company_id || '') === String(companyId));
                if (already) return interaction.editReply({content: `You already own ${item.name} for ${selectedCompany.name}.`, components: []});
            }
        } else if (!item.stackable) {
            // Prevent duplicate non-stackable tools
            const already = (user.inventory || []).some(e => String(e.item_id) === String(item._id));
            if (already) return interaction.editReply({content: `You already own ${item.name}.`});
        }

        // Enforce rotation membership and stock when enabled
        if (process.env.SHOP_ROTATE_ENABLED === 'true') {
            const rotation = await getActiveRotation();
            const inRotation = (rotation.item_ids || []).some(id => String(id) === String(item._id));
            if (!inRotation) return interaction.editReply({content: 'This item is not available in the current rotation. Please check /shop list.', components: []});
            // Enforce daily stock cap
            const dayKey = getDayKey();
            const capDefault = Number(process.env.SHOP_DAILY_CAP_DEFAULT || 50);
            // Upsert stock doc if absent
            let st = await ItemStock.findOneAndUpdate(
                {item_id: item._id, dayKey},
                {$setOnInsert: {item_id: item._id, dayKey, cap: capDefault, sold: 0}},
                {upsert: true, new: true}
            );
            const want = qty;
            if ((st.sold + want) > (st.cap ?? capDefault)) {
                return interaction.editReply({content: 'This item is out of stock for today. Check back after the daily reset.', components: []});
            }
            // Reserve stock
            await ItemStock.updateOne({_id: st._id, sold: st.sold}, {$inc: {sold: want}});
        }

        const cost = item.price * qty;
        if ((user.balance || 0) < cost) {
            return interaction.editReply({content: `You do not have enough balance to buy ${qty}x ${item.name}. You need $${cost}, but you have $${user.balance || 0}.`, components: []});
        }
        await Users.updateOne({_id: user._id}, {$inc: {balance: -cost}});
 
        const existingIdx = (user.inventory || []).findIndex(e => String(e.item_id) === String(item._id) && String(e.company_id || '') === String(companyId || ''));
        if (existingIdx >= 0) {
            await Users.updateOne({_id: user._id}, {$inc: {[`inventory.${existingIdx}.qty`]: qty}});
        } else {
            await Users.updateOne({_id: user._id}, {
                $push: {
                    inventory: {
                        item_id: item._id,
                        company_id: companyId,
                        qty
                    }
                }
            });
        }

        if (companyId) {
            await updateCompanyReputation(user._id, companyId, 1);
        }

        const embed = new EmbedBuilder()
            .setTitle('Purchase Confirmed')
            .setDescription(`You bought ${qty}x ${item.name}${selectedCompany ? ` for ${selectedCompany.name}` : ''} for $${cost}.`)
            .setColor('#FFD166')
            .setTimestamp();
        return interaction.editReply({embeds: [embed], components: []});
    } catch (e) {
        console.error('shop buy error:', e);
        return interaction.editReply({content: 'There was an error processing your purchase.'});
    }
}

async function promptForCompany(interaction, item) {
    const sampleSize = Math.random() < 0.5 ? 2 : 3;
    const choices = await Company.aggregate([{$sample: {size: sampleSize}}]);
    if (!choices.length) return null;
    if (choices.length === 1) return choices[0];

    const customId = `shop_company_${interaction.id}`;
    const menu = new StringSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder('Choose a company')
        .addOptions(choices.map(company => ({
            label: company.name.slice(0, 100),
            description: `Buy ${item.name} for this company`.slice(0, 100),
            value: String(company._id)
        })));

    const row = new ActionRowBuilder().addComponents(menu);
    const message = await interaction.editReply({
        content: `Choose a company for **${item.name}**:`,
        components: [row],
        fetchReply: true
    });

    const response = await message.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        filter: i => i.user.id === interaction.user.id && i.customId === customId,
        time: 120000
    }).catch(() => null);

    if (!response) return null;
    const company = choices.find(c => String(c._id) === response.values[0]);
    await response.update({
        content: company ? `Selected **${company.name}**. Processing purchase...` : 'Processing purchase...',
        components: []
    });
    return company || null;
}

async function updateCompanyReputation(userId, companyId, change) {
    const user = await Users.findById(userId);
    if (!user || !companyId) return;

    const existingRep = user.reputation_breakdown?.find(
        r => r.company_id?.toString() === companyId.toString()
    );

    if (existingRep) {
        await Users.updateOne(
            {_id: userId, 'reputation_breakdown.company_id': companyId},
            {$inc: {'reputation_breakdown.$.trust_score': change}}
        );
    } else {
        await Users.updateOne(
            {_id: userId},
            {
                $push: {
                    reputation_breakdown: {
                        company_id: companyId,
                        trust_score: Math.max(0, change)
                    }
                }
            }
        );
    }
}

async function showInventory(interaction) {
    await interaction.deferReply({flags: 64});
    const user = await Users.findOne({discord_id: interaction.user.id}).populate('inventory.item_id').populate('inventory.company_id');
    if (!user) return interaction.editReply({content: 'User not found.'});
    const inv = user.inventory || [];
    if (!inv.length) return interaction.editReply({content: 'Your inventory is empty.'});
    const embed = new EmbedBuilder().setTitle(`${interaction.user.username}'s Inventory`).setColor('#7289DA');
    for (const e of inv) {
        const name = e.item_id?.name || 'Unknown Item';
        const key = e.item_id?.key || '';
        const qty = e.qty || 0;
        const comp = e.company_id?.name ? ` — ${e.company_id.name}` : '';
        embed.addFields({name: `${name}${comp}`, value: `Key: ${key} | Qty: ${qty}`, inline: false});
    }
    return interaction.editReply({embeds: [embed]});
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDayKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
