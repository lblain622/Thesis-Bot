const { Schema, model } = require('mongoose');

const bountyTierSchema = new Schema({
  severity: { type: String, required: true, enum: ['low', 'medium', 'high', 'critical'] },
  min_value: { type: Number, required: true },
  max_value: { type: Number, required: true },
  description: { type: String },
});

module.exports = model('Bounty_tiers', bountyTierSchema);
