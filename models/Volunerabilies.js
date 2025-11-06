const { Schema, model } = require('mongoose');

const volunerabilitySchema = new Schema({
    company_id: {
        type: String,
        required: true
    },
    volun_type: String,
    name: String,
    description: String,
    severity: String,
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
    experation_date: Date,
    visibility: {
        isGlobal: {
            type: Boolean,
            default: false
        },
        allowedUsers: [{
            type: Schema.Types.ObjectId,
            ref: 'User'
        }]
    }
  
}, { timestamps: true });

module.exports = model('Volunerabilies', volunerabilitySchema);
