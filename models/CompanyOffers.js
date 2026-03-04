const { Schema, model } = require('mongoose');

const companyOfferSchema = new Schema({

    // Linking
    company_id: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    user_id: { type: Schema.Types.ObjectId, ref: 'Users', default: null },

    report_id: {
        type: Schema.Types.ObjectId,
        ref: 'Report'
    },
    original_amount: {
        type: Number,
        default: 0
    },
    // base amount before any bonuses or modifiers were applied
    base_amount: {
        type: Number,
        default: 0
    },
    bonus_details: {
        company: { type: Number, default: 0 },
        reputation: { type: Number, default: 0 },
        preferred: { type: Number, default: 0 },
        constant: { type: Number, default: 0 },
        luckyToken: { type: Number, default: 0 },
        itemCashReduction: { type: Number, default: 0 }
    },
    offered_amount: {
        type: Number,
        default: 0
    },
    offer_percent: {
        type: Number,
        default: 0
    },
    repuatation_offered: Number,
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'expired'],
        default: 'pending'
    },
    expires_at: Date,
    created_at: {
        type: Date,
        default: Date.now
    },
    dictator_choice: {
        type: String,
        enum: ['option1', 'option2', null],
        default: null,
      },
    dictator_options: {
        type: Object,
        default: null,
      },

    items: [
        {
            item_id: { type: Schema.Types.ObjectId, ref: 'Items', required: true },
            company_id: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
            qty: { type: Number, default: 1, min: 1 }
        }
    ],
    // Audit field to mark why cash was reduced, e.g., 'item_bonus'
    cash_reduction_reason: { type: String, default: null },
    // Keep legacy fields for backward compatibility
    resloved_at: Date,
    counter_offered: Number,
    // fields for vouching payouts
    voucher_user_id: { type: Schema.Types.ObjectId, ref: 'Users', default: null },
    voucher_amount: { type: Number, default: 0 },

    // Canonical fields used by interaction handlers
    resolved_at: { type: Date, default: null },
    counter_offer: { type: Number, default: null },

}, { timestamps: true });

// Performance indexes
companyOfferSchema.index({ report_id: 1 });
companyOfferSchema.index({ status: 1, expires_at: 1 });

companyOfferSchema.index({ company_id: 1 });
companyOfferSchema.index({ user_id: 1 });
companyOfferSchema.index({ 'items.item_id': 1 });


module.exports = model('Company_Offer', companyOfferSchema);
