const { Schema, model } = require('mongoose');

const bountyTierSchema = new Schema({
    severity: String,
    min_value: String,
    max_value: String,
    description: String
}, { timestamps: true });

module.exports = model('Bounty_Tier', bountyTierSchema);
