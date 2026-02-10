const { Schema, model } = require('mongoose');

const itemStockSchema = new Schema({
  item_id: { type: Schema.Types.ObjectId, ref: 'Items', required: true },
  dayKey: { type: String, required: true }, // YYYY-MM-DD (server local)
  sold: { type: Number, default: 0, min: 0 },
  cap: { type: Number, default: 50, min: 0 },
}, { timestamps: true });

itemStockSchema.index({ item_id: 1, dayKey: 1 }, { unique: true });
itemStockSchema.index({ dayKey: 1 });

module.exports = model('ItemStock', itemStockSchema);
