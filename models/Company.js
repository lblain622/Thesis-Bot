const { Schema, model } = require('mongoose');

const companySchema = new Schema({
    name: {
        type: String,
        required: true
    },
    description: String,
    platform_id: {
        type: Schema.Types.ObjectId,
        ref: 'Platform',
        required: true
    },
    // Product/Industry focus
    product_type: {
        type: String,
        enum: ['web_app', 'mobile_app', 'api', 'infrastructure', 'iot', 'blockchain', 'ai_ml'],
        default: 'web_app'
    },
    // Preferred vulnerability types (for bonuses)
    preferred_vulns: [{
        type: String,
        enum: ['XSS', 'SQLi', 'CSRF', 'RCE', 'IDOR', 'Authentication', 'Authorization',
               'Information_Disclosure', 'Business_Logic', 'Cryptographic', 'Other',
               'Authentication_Bypass', 'Buffer_Overflow', 'Command_Injection',
               'Cross_Site_Scripting', 'Denial_of_Service', 'Insecure_Deserialization',
               'Open_Redirect', 'Path_Traversal', 'Privilege_Escalation',
               'Race_Condition', 'Remote_Code_Execution', 'SQL_Injection', 'SSRF',
               'XML_External_Entity']
    }],
    // Reputation bonus multipliers
    reputation_tiers: [{
        min_reputation: { type: Number, default: 0 },
        max_reputation: { type: Number, default: 100 },
        bonus_multiplier: { type: Number, default: 1.0 },
        special_perks: [String]
    }],
    variants: {
        type: Array,
        default: []
    },
    bounty_tiers: [{
        type: Schema.Types.ObjectId,
        ref: 'Bounty_tiers'
    }],
    // minimum reputation required to submit reports / receive offers
    reputation_threshold: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

module.exports = model('Company', companySchema);
