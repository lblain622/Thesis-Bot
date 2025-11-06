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
    resloved_at: Date,
    counter_offered: Number,
}, { timestamps: true });

module.exports = model('Company_Offer', companyOfferSchema);
