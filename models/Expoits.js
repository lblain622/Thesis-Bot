const { Schema, model } = require('mongoose');

const exploitSchema = new Schema({
    volunerability_id:{
        type: Schema.Types.ObjectId,
        ref: 'Volunerabilies'
    },
    exposure_chance:{
        type: Number
    },
    money_per_cycle:{
        type:Number,
    },
    last_rewarded:{
        type:Date
    }
})

module.exports = model("Exploit",exploitSchema)