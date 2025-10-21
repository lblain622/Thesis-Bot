const { Schema, model } = require('mongoose');

const userSchema = new Schema({
    discord_id: {
        type: String,
        required: true
    },
    reports_made: {
        type: Number,
        default: 0
    },
    money_earned: {
        type: Number,
        default: 0
    },
    repuation_earned: {
        type: Number,
        default: 0
    },
    last_active: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = model('User', userSchema);
