const { Schema, model } = require('mongoose');

const tradeSchema = new Schema({
 giving_user_id:{
     type:Schema.Types.ObjectId,
     ref: 'Users'
 },
 recieving_user_id:{
     type:Schema.Types.ObjectId,
     ref: 'Users'
 },
 gu_item_type:{
     type:String,
     emun:['volunerabilies','money','both']
 },
 ru_item_type:{
     type:String,
     emun:['volunerabilies','money','both']
 }

})

module.export = model("Trades",tradeSchema);