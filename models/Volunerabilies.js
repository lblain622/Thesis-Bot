const { Schema, model } = require('mongoose');

const volunerabilitySchema = new Schema({
    company_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
  
    vuln_identifier: {
        type: String,
        required: true,
        unique: true
    },
    volun_type: {
        type: String,
        enum: ['XSS', 'SQLi', 'CSRF', 'RCE', 'IDOR', 'Authentication', 'Authorization',
               'Information_Disclosure', 'Business_Logic', 'Cryptographic', 'Other'],
        required: true
    },
    name: String,
    description: String,

    cvss_score: {
        type: Number,
        min: 0,
        max: 10
    },
    cvss_vector: String,
    severity: {
        type: String,
        enum: ['None', 'Low', 'Medium', 'High', 'Critical'],
        required: true
    },

    pocs_submitted: [{
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'Users'
        },
        submitted_at: Date,
        poc_data: {
            steps: [String],
            screenshots: [String],
            notes: String
        }
    }],

    reported_by: [{
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'Users'
        },
        reported_at: Date,
        report_id: {
            type: Schema.Types.ObjectId,
            ref: 'Report'
        }
    }],

    first_reporter: {
        type: Schema.Types.ObjectId,
        ref: 'Users'
    },
    first_reported_at: Date,
    isReported: {
        type: Boolean,
        default: false
    },
    isResolved: {
        type: Boolean,
        default: false
    },
    is_resolved_date: Date,
    reported_date: Date,
    expiration_date: Date,

    visibility: {
        isGlobal: {
            type: Boolean,
            default: false
        },
        allowedUsers: [{
            type: Schema.Types.ObjectId,
            ref: 'Users'
        }]
    },

    discovered_by: [{
        user_id: {
            type: Schema.Types.ObjectId,
            ref: 'Users'
        },
        discovered_at: {
            type: Date,
            default: Date.now
        }
    }]
}, { timestamps: true });

volunerabilitySchema.index({ company_id: 1, isReported: 1 });
volunerabilitySchema.index({ 'visibility.allowedUsers': 1 });
volunerabilitySchema.index({ 'reported_by.user_id': 1 });

module.exports = model('Volunerabilies', volunerabilitySchema);
