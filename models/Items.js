const { Schema, model } = require('mongoose');

// Generic in-game item for Shop system
// Effects schema kept flexible to allow different boosts
const itemSchema = new Schema({
  key: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  type: { type: String, enum: ['merch', 'tool', 'consumable'], required: true },
  price: { type: Number, required: true, min: 0 },
  stackable: { type: Boolean, default: false },
  companyScoped: { type: Boolean, default: false }, // if true, inventory entry may include company_id
  enabled: { type: Boolean, default: true },
 
  effects: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

itemSchema.index({ enabled: 1 });

module.exports = model('Items', itemSchema);
