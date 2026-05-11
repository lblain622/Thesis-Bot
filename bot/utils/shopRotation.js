const Items = require('../../models/Items');
const ShopRotation = require('../../models/ShopRotation');

const ROTATE_MS = Number(process.env.SHOP_ROTATE_MS || 5 * 60 * 1000); // 5 minutes
const ROTATE_SIZE = Number(process.env.SHOP_ROTATE_SIZE || 4);
const PRICE_BUCKETS = [
    {min: 0, max: 500},
    {min: 501, max: 1000},
    {min: 1001, max: 2000},
    {min: 2001, max: Infinity}
];

let rotationInterval = null;

function getNow() {
    return new Date();
}

async function pickRotationItems() {
    const enabled = await Items.find({enabled: true}).lean();
    if (!enabled.length) return [];

    const chosen = [];
    const chosenIds = new Set();
    for (const bucket of PRICE_BUCKETS) {
        if (chosen.length >= ROTATE_SIZE) break;
        const candidates = enabled.filter(i =>
            !chosenIds.has(String(i._id)) &&
            i.price >= bucket.min &&
            i.price <= bucket.max
        );
        if (!candidates.length) continue;
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        chosen.push(pick);
        chosenIds.add(String(pick._id));
    }

    const remaining = enabled
        .filter(i => !chosenIds.has(String(i._id)))
        .sort(() => 0.5 - Math.random());
    for (const item of remaining) {
        if (chosen.length >= ROTATE_SIZE) break;
        chosen.push(item);
    }

    return chosen.map(i => i._id);
}

async function ensureActiveWindow() {
    const now = getNow();
    const active = await ShopRotation.findOne({active_until: {$gt: now}}).lean();
    if (active) return active;
    const from = now;
    const until = new Date(now.getTime() + ROTATE_MS);
    const item_ids = await pickRotationItems();
    const doc = await ShopRotation.create({active_from: from, active_until: until, item_ids});
    return doc.toObject ? doc.toObject() : doc;
}

async function rotateOnce() {
    try {
        const now = getNow();
        const from = now;
        const until = new Date(now.getTime() + ROTATE_MS);
        const item_ids = await pickRotationItems();
        await ShopRotation.create({active_from: from, active_until: until, item_ids});
    } catch (e) {
        console.error('[ShopRotation] rotateOnce error:', e);
    }
}

async function getActiveRotation() {
    const now = getNow();
    let active = await ShopRotation.findOne({active_until: {$gt: now}}).sort({active_until: -1}).lean();
    if (!active) active = await ensureActiveWindow();
    return active;
}

async function initializeShopRotation() {
    if (process.env.SHOP_ROTATE_ENABLED !== 'true') return;
    await ensureActiveWindow();
    if (!rotationInterval) {
        rotationInterval = setInterval(() => {
            rotateOnce().catch((e) => console.error('[ShopRotation] interval error', e));
        }, ROTATE_MS);
    }
}

function cleanupShopRotation() {
    if (rotationInterval) {
        clearInterval(rotationInterval);
        rotationInterval = null;
    }
}

module.exports = {
    initializeShopRotation,
    cleanupShopRotation,
    getActiveRotation,
};
