const { Schema, model } = require('mongoose');

const LogSchema = new Schema({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'Users',
    required: true,
  },
 
  action: {
    type: String,
    required: true,
  },
}, { timestamps: true });


module.exports = model('Log', LogSchema);