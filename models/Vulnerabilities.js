const { Schema, model } = require('mongoose');

const vulnerabilitySchema = new Schema({
    company_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: false
    },

    // Round the vulnerability was generated in (legacy; optional in continuous mode)
    round_id: {
        type: Schema.Types.ObjectId,
        ref: 'Round',
        required: false},



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
    // Severity used by offers/reporting flows
    severity: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        default: 'LOW'
    },
    name: String,
    description: String,

    
    networkAccess: {
        answer: { type: String, enum: ['Yes', 'No'] },
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    arbitraryCodeExecution: {
        answer: { type: String, enum: ['Yes', 'No'] },
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    userInteraction: {
        answer: { type: String, enum: ['Yes', 'No'], default: 'No' },
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    automatable: {
        answer: { type: String, enum: ['Yes', 'No'], },
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    confidentialityImpact: {
        answer: { type: String, enum: ['None', 'Low', 'Medium', 'High']},
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    integrityImpact: {
        answer: { type: String, enum: ['None', 'Low', 'Medium', 'High'] },
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    availabilityImpact: {
        answer: { type: String, enum: ['None', 'Low', 'Medium', 'High']},
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    privilegesRequired: {
        answer: { type: String, enum: ['None', 'Low', 'High']},
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },
    recoveryPotential: {
        answer: { type: String, enum: ['Automatic', 'User', 'Irrecoverable','Unknown'],},
        visibleTo: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },

    
    pocs_submitted: [{
        user_id: { type: Schema.Types.ObjectId, ref: 'Users' },
        submitted_at: Date,
        poc_data: {
            steps: [String],
            screenshots: [String],
            notes: String
        }
    }],

    reported_by: [{
        user_id: { type: Schema.Types.ObjectId, ref: 'Users' },
        reported_at: Date,
        report_id: { type: Schema.Types.ObjectId, ref: 'Report' }
    }],

    first_reporter: { type: Schema.Types.ObjectId, ref: 'Users' },
    first_reported_at: Date,
    isReported: { type: Boolean, default: false },
    isResolved: { type: Boolean, default: false },
    is_resolved_date: Date,
    reported_date: Date,
    expiration_date: Date,

    visibility: {
        isGlobal: { type: Boolean, default: false },
        allowedUsers: [{ type: Schema.Types.ObjectId, ref: 'Users' }]
    },

    discovered_by: [{
        user_id: { type: Schema.Types.ObjectId, ref: 'Users' },
        discovered_at: { type: Date, default: Date.now }
    }],

    expolited_count:{
        type:Number,
        default:0

    },

    // Auto-offer scheduler helpers
    offer_wait_started_at: { type: Date, default: null },
    last_offer_report_id: { type: Schema.Types.ObjectId, ref: 'Report', default: null }
}, { timestamps: true });

// Performance indexes
vulnerabilitySchema.index({ company_id: 1, isResolved: 1 });
vulnerabilitySchema.index({ 'visibility.allowedUsers': 1, isResolved: 1 });
vulnerabilitySchema.index({ isResolved: 1, isReported: 1 });
vulnerabilitySchema.index({ round_id: 1 });

module.exports = model('Vulnerabilities', vulnerabilitySchema);