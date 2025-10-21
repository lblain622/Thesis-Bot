const {Schema,model} = require('moongoose');

const userSchema = new Schema({
    id:{
        type:String,
        required:true
    },
    discord_id:{
        type:String,
        required:true
    },
    money_made:{
        type:Number,
        required:true,
        default:0
    },
    reputation_made:{
        type:Number,
        required:true,
        default:0
    },
},{timestamps:true})

module.exports = userSchema
