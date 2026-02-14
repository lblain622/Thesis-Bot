const { Schema, model } = require('mongoose');

const companyOfferSchema = new Schema({
<<<<<<< HEAD
    // Linking
    company_id: { type: Schema.Types.ObjectId, ref: 'Company', default: null },
    user_id: { type: Schema.Types.ObjectId, ref: 'Users', default: null },
=======
>>>>>>> c4e8d7b66858ab1ecaa582fc1f17cc3477b7e201
    report_id: {
        type: Schema.Types.ObjectId,
        ref: 'Report'
    },
    original_amount: {
        type: Number,
        default: 0
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
<<<<<<< HEAD
    // Optional item bundle when an offer includes items (merch/tools)
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
    // Canonical fields used by interaction handlers
    resolved_at: { type: Date, default: null },
    counter_offer: { type: Number, default: null },
=======
    resloved_at: Date,
    counter_offered: Number,
>>>>>>> c4e8d7b66858ab1ecaa582fc1f17cc3477b7e201
}, { timestamps: true });

// Performance indexes
companyOfferSchema.index({ report_id: 1 });
companyOfferSchema.index({ status: 1, expires_at: 1 });
<<<<<<< HEAD
companyOfferSchema.index({ company_id: 1 });
companyOfferSchema.index({ user_id: 1 });
companyOfferSchema.index({ 'items.item_id': 1 });
=======
>>>>>>> c4e8d7b66858ab1ecaa582fc1f17cc3477b7e201

module.exports = model('Company_Offer', companyOfferSchema);
