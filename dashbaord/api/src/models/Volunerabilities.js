const { Schema, model } = require('mongoose');

const vulnerabilitySchema = new Schema({
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
    experation_date: Date
}, { timestamps: true });

module.exports = model('Vulnerability', vulnerabilitySchema);
