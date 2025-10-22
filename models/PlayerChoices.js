const { Schema, model } = require('mongoose');

const playerChoiceSchema = new Schema({
    offer_id: {
        type: Schema.Types.ObjectId,
        ref: 'Company_Offer'
    },
    user_id: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    choice_made: {
        type: Schema.Types.ObjectId
    },
    choice_data: {
        type: Object
    }
}, { timestamps: true });

module.exports = model('Player_Choice', playerChoiceSchema);
