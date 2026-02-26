const Log = require('../../models/Log');
const User = require('../../models/Users');


async function logAction(userId, actionDesc) {
  if (!userId || !actionDesc) return;
  try {
    await Log.create({ user_id: userId, action: actionDesc });
  } catch (err) {
    console.error('Failed to log action:', err);
  }
}


async function notifyUser(client, userId, messageContent, options = {}) {
  try {
    const user = await User.findById(userId).lean();
    if (!user || !user.dashboard_channel_id) return;
    const channel = await client.channels.fetch(user.dashboard_channel_id).catch(() => null);
    if (channel && channel.isTextBased()) {
      if (typeof messageContent === 'string') {
        await channel.send({content: messageContent, ...options});
      } else {
        // assume already an object
        await channel.send(messageContent);
      }
    }
  } catch (err) {
    console.error('notifyUser error:', err);
  }
}

module.exports = { logAction, notifyUser };
