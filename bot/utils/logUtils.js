const Log = require('../../models/Log');

/**
 * Record a user action in the log collection.
 *
 * @param {import('mongoose').Types.ObjectId} userId - the Mongo id of the user performing the action
 * @param {string} actionDesc - human-readable description of the action
 * @returns {Promise<void>}
 */
async function logAction(userId, actionDesc) {
  if (!userId || !actionDesc) return;
  try {
    await Log.create({ user_id: userId, action: actionDesc });
  } catch (err) {
    console.error('Failed to log action:', err);
  }
}

module.exports = { logAction };
