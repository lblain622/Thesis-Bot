const { Schema, model } = require('mongoose');

const companySchema = new Schema({
    name: {
        type: String,
        required: true
    },
    description: String,
    platform_id: {
        type: Schema.Types.ObjectId,
        ref: 'Platform'
    },
    variants: {
        type: Array,
        default: []
    },
    bounty_tiers: {
        type: Array,
        default: []
    }
}, { timestamps: true });

module.exports = model('Company', companySchema);
