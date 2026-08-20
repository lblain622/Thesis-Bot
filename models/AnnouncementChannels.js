const { Schema, model } = require('mongoose');

const announcementChannelsSchema = new Schema({
    guild_id: {
        type: String,
        required: true,
        unique: true
    },

    channels: {
        vulnerabilities: {
            type: String,
            default: null
        },
        trades: {
            type: String,
            default: null
        },
        offers: {
            type: String,
            default: null
        },
        exploits: {
            type: String,
            default: null
        },
        general: {
            type: String,
            default: null
        }
    },
    updated_at: {
        type: Date,
        default: Date.now
    }
});

module.exports = model('AnnouncementChannels', announcementChannelsSchema);
