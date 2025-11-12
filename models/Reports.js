const { Schema, model } = require('mongoose');

const reportSchema = new Schema({
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'Users',
        required: true
    },
    platform_id: {
        type: Schema.Types.ObjectId,
        ref: 'Platform',
        required: true
    },
    company_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    vulnerability_id: {
        type: Schema.Types.ObjectId,
        ref: 'Volunerabilies'
    },

    vuln_identifier: String,
    volunerablity_sev: {
        type: String,
        enum: ['None', 'Low', 'Medium', 'High', 'Critical'],
        required: true
    },

    cvss_score: Number,
    cvss_vector: String,

    is_poc_only: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed', 'poc_submitted'],
        default: 'open'
    },
    submitted_at: {
        type: Date,
        default: Date.now
    },
    // Bonus information
    reputation_bonus: {
        type: Number,
        default: 0
    },
    preferred_vuln_bonus: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = model('Report', reportSchema);