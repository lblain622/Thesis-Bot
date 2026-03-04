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
        enum: ['None', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        required: true
    },
    // CVSS information
    cvss_score: Number,
    cvss_vector: String,

    report_title: String,
    report_description: String,
    impact_description: String,
    poc_steps: [String],

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

    reputation_bonus: {
        type: Number,
        default: 0
    },
    preferred_vuln_bonus: {
        type: Number,
        default: 0
    },

    offered_amount: {
        type: Number,
        default: 0
    },
    VouchingUser:{
        type: Schema.Types.ObjectId,
        ref: 'Users',
        default: null
    }
}, { timestamps: true });

// Performance indexes
reportSchema.index({ user_id: 1, submitted_at: -1 });
reportSchema.index({ vulnerability_id: 1 });
reportSchema.index({ company_id: 1, status: 1 });
reportSchema.index({ platform_id: 1 });

module.exports = model('Report', reportSchema);