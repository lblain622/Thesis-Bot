const { Schema, model } = require('mongoose');

const LogSchema = new Schema({
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'Users',
    required: true,
  },
  // textual description of the action performed (e.g. command + args)
  action: {
    type: String,
    required: true,
  },
}, { timestamps: true });


module.exports = model('Log', LogSchema);