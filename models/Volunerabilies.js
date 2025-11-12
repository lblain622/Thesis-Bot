const volunerabilitySchema = new Schema({
    company_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    // Vulnerability identification (user provides fake name/ID)
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
    // CVSS Scoring
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
   
    poc_submitted: {
        type: Boolean,
        default: false
    },
    poc_data: {
        steps: [String],
        screenshots: [String],
        notes: String
    },
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
    // Discovery metadata
    discovered_by: {
        type: Schema.Types.ObjectId,
        ref: 'Users'
    },
    discovered_at: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

volunerabilitySchema.index({ vuln_identifier: 1 });
volunerabilitySchema.index({ company_id: 1, isReported: 1 });

module.exports = model('Volunerabilies', volunerabilitySchema);
