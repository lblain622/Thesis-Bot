const { Schema, model } = require('mongoose');

const tradeSchema = new Schema({
    giving_user_id: {
        type: Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    receiving_user_id: {
        type: Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    gu_item_type: {
        type: String,
        enum: ['vulnerability', 'money'],
        required: true
    },
    ru_item_type: {
        type: String,
        enum: ['vulnerability', 'money'],
        required: true
    },
    gu_value: {
        type: Schema.Types.Mixed,
        required: true
    },
    ru_value: {
        type: Schema.Types.Mixed,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
    },
    created_at: {
        type: Date,
        default: Date.now
    },
    expires_at: {
        type: Date,
        required: true
    },
    resolved_at: Date
}, { timestamps: true });

// Performance indexes
tradeSchema.index({ giving_user_id: 1, status: 1 });
tradeSchema.index({ receiving_user_id: 1, status: 1 });
tradeSchema.index({ status: 1, expires_at: 1 });

module.exports = model('Trade', tradeSchema);