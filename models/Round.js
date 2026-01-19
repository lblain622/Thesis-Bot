const { Schema, model } = require('mongoose');

const roundSchema = new Schema({
    round_number: {
        type: Number,
        required: true,
        unique: true
    },
    start_date: {
        type: Date,
        required: true,
        default: Date.now
    },
    end_date: {
        type: Date
    },
    status: {
        type: String,
        enum: ['active', 'ended'],
        default: 'active'
    },
    //relpace with volun resolved?,
    vulnerabilities_resolved: {
        type: Number,
        default: 0
    },
    vulnerabilities_generated: {
        type: Number,
        default: 0
    },
    reports_submitted: {
        type: Number,
        default: 0
    },

    total_payout: {
        type: Number,
        default: 0
    },
    companies_involved: [{
        type: Schema.Types.ObjectId,
        ref: 'Company'
    }]
}, {
    timestamps: true
});

module.exports = model('Round', roundSchema);