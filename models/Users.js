const { Schema, model } = require('mongoose');

const userSchema = new Schema({
    discord_id: {
        type: String,
        required: true
    },
    discord_name:{
        type: String,
        required: true
    },
    reports_made: {
        type: Number,
        default: 0
    },
    money_earned: {
        type: Number,
        default: 0
    },
    repuation_earned: {
        type: Number,
        default: 0
    },
    last_active: {
        type: Date,
        default: Date.now
    },
    reputation_breakdown:[
        {
            company_id: {
                type: Schema.Types.ObjectId,
                ref: 'Companies',
                required: true
            },
            trust_score: {
                type: Number,
                default: 0
            }
        }
    ],
    // Shop inventory entries
    inventory: [
        {
            item_id: { type: Schema.Types.ObjectId, ref: 'Items', required: true },
            company_id: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
            qty: { type: Number, default: 1, min: 0 }
        }
    ]
}, { timestamps: true });

// Performance indexes
userSchema.index({ discord_id: 1 }, { unique: true });
userSchema.index({ last_active: -1 });
userSchema.index({ 'reputation_breakdown.company_id': 1 });
userSchema.index({ 'inventory.item_id': 1 });

module.exports = model('Users', userSchema);
