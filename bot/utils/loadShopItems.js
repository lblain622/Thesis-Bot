const fs = require('fs');
const path = require('path');
const Items = require('../../models/Items');

async function loadShopItems() {
  try {
    const file = path.join(__dirname, '..', '..', 'data', 'shop-items.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const items = JSON.parse(raw);
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it.key) continue;
      await Items.findOneAndUpdate(
        { key: it.key },
        { $set: it },
        { upsert: true }
      );
    }
    console.log(`[Shop] Loaded ${items.length} items.`);
    return { count: items.length };
  } catch (e) {
    console.error('[Shop] Failed to load items:', e);
    return { count: 0, error: true };
  }
}

module.exports = { loadShopItems };
