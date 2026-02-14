const Items = require('../../models/Items');
const Users = require('../../models/Users');

async function fetchInventoryItems(user) {
    const inv = Array.isArray(user.inventory) ? user.inventory : [];
    if (!inv.length) return [];
    const ids = inv.map(e => e.item_id).filter(Boolean);
    const docs = await Items.find({_id: {$in: ids}, enabled: true}).lean();
    const byId = new Map(docs.map(d => [String(d._id), d]));
    return inv
        .map(e => ({...e, item: byId.get(String(e.item_id))}))
        .filter(e => e.item);
}

function aggSearchBoosts(entries) {
    let extraDiscover = 0;
    let extraFields = 0;
    let maxFieldsCap = 6; // default cap
    for (const e of entries) {
        const eff = e.item.effects || {};
        const s = eff.search || {};
        if (s.extraDiscover) {
            // non-stackable respected by qty when stackable=false
            extraDiscover += Number(s.extraDiscover) * (e.item.stackable ? (e.qty || 1) : 1);
        }
        if (s.extraFields) {
            const stacks = e.item.stackable ? Math.min(e.qty || 1, (s.maxStacks || Infinity)) : 1;
            extraFields += Number(s.extraFields) * stacks;
        }
        if (s.maxFieldsCap) maxFieldsCap = Math.max(maxFieldsCap, Number(s.maxFieldsCap));
    }
    // reasonable bounds
    extraDiscover = Math.max(0, Math.min(extraDiscover, 3));
    extraFields = Math.max(0, Math.min(extraFields, 3));
    return {extraDiscover, extraFields, maxFieldsCap};
}

function computeCompanyBonusPct(entries, companyId) {
    let bonus = 0;
    const cid = companyId ? String(companyId) : null;
    for (const e of entries) {
        const eff = e.item.effects || {};
        const off = eff.offer || {};
        const pct = Number(off.companyBonusPct || 0);
        if (!pct) continue;
        if (e.item.companyScoped) {
            if (!cid) continue;
            if (String(e.company_id || '') !== cid) continue;
        }
        bonus = Math.max(bonus, pct);
    }
    return bonus;
}

async function maybeConsumeLuckyToken(userId) {
    // Find any inventory entry for item key lucky_token with qty>0
    const tokenItem = await Items.findOne({key: 'lucky_token', enabled: true}).lean();
    if (!tokenItem) return {triggered: false};
    const user = await Users.findById(userId).lean();
    if (!user) return {triggered: false};
    const idx = (user.inventory || []).findIndex(e => String(e.item_id) === String(tokenItem._id) && (e.qty || 0) > 0);
    if (idx === -1) return {triggered: false};
    const chance = Number((tokenItem.effects?.consumable?.doubleNextOfferChancePct) || 0);
    const roll = Math.random() * 100;
    if (roll >= chance) return {triggered: false};
    // consume 1 token
    try {
        await Users.updateOne({
            _id: userId,
            [`inventory.${idx}.qty`]: {$gt: 0}
        }, {$inc: {[`inventory.${idx}.qty`]: -1}});
    } catch (_) {
    }
    return {triggered: true};
}

async function grantMerchantHatIfMissing(userId, companyId) {
    const hat = await Items.findOne({key: 'merchant_hat', enabled: true}).lean();
    if (!hat) return false;
    const user = await Users.findById(userId).lean();
    if (!user) return false;
    const has = (user.inventory || []).some(e => String(e.item_id) === String(hat._id) && String(e.company_id || '') === String(companyId || ''));
    if (has) return false;
    try {
        await Users.updateOne({_id: userId}, {
            $push: {inventory: {item_id: hat._id, company_id: companyId || null, qty: 1}}
        });
        return true;
    } catch (e) {
        return false;
    }
}

module.exports = {
    fetchInventoryItems,
    aggSearchBoosts,
    computeCompanyBonusPct,
    maybeConsumeLuckyToken,
    grantMerchantHatIfMissing,
};
