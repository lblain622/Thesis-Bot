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
    // Main spendable balance used for purchases and trade thresholds
    balance: {
        type: Number,
        default: 0
    },
    // Breakdown of balance sources
    money_from_exploits: {
        type: Number,
        default: 0
    },
    money_from_reports: {
        type: Number,
        default: 0
    },
    money_from_trades: {
        type: Number,
        default: 0
    },
    money_fined:{
    type:Number,
    default:0
    },
    reputation_earned: {
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
    ],
    dashboard_channel_id: {
        type: String,
        default: null,
    }
}, { timestamps: true });

// Performance indexes
userSchema.index({ discord_id: 1 }, { unique: true });
userSchema.index({ last_active: -1 });
userSchema.index({ 'reputation_breakdown.company_id': 1 });
userSchema.index({ 'inventory.item_id': 1 });

module.exports = model('Users', userSchema);
