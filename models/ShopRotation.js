const { Schema, model } = require('mongoose');

const shopRotationSchema = new Schema({
  active_from: { type: Date, required: true },
  active_until: { type: Date, required: true },
  item_ids: [{ type: Schema.Types.ObjectId, ref: 'Items', required: true }],
}, { timestamps: true });

shopRotationSchema.index({ active_until: 1 });

module.exports = model('ShopRotation', shopRotationSchema);
