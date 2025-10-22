const { Schema, model } = require('mongoose');

const reportSchema = new Schema({
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    platform_id: {
        type: Schema.Types.ObjectId,
        ref: 'Platform'
    },
    company_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company'
    },
    vulnerability_id: { type: Schema.Types.ObjectId, ref: 'Volunerabilies' },

    volunerablity_sev: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        required: true
    },
    status: {
        type: String,
        enum: ['open', 'in_progress', 'resolved', 'closed'],
        default: 'open'
    },
    submitted_at: {
        type: String
    }
}, { timestamps: true });

module.exports = model('Report', reportSchema);
