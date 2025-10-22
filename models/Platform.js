const { Schema, model } = require('mongoose');

const platformSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    description: String,
    base_policies: {
        response_speed: String,
        safe_harbor: String,
        payout_speed: String,
        overall_transparency: String,
        offer_multiplier: String
    },
    variants: {
        type: Array,
        default: []
    }
}, { timestamps: true });

module.exports = model('Platform', platformSchema);
