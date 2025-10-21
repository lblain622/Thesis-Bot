const { Schema, model } = require('mongoose');

const companyOfferSchema = new Schema({
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
    repuatation_offered: String,
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
    resloved_at: Date
}, { timestamps: true });

module.exports = model('Company_Offer', companyOfferSchema);
