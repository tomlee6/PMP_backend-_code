const db = require('../db/connection');
const { getUserSockets } = require('./socket');

async function createNotification(userId, title, message, module, referenceType, referenceId) {
  const [result] = await db.query(
    `INSERT INTO notifications (user_id, title, message, module, reference_type, reference_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, title, message, module, referenceType, referenceId]
  );
  
  // Send Real-Time Socket.IO notification if user is online
  const sockets = getUserSockets(userId);
  if (sockets && sockets.size > 0) {
    const notificationPayload = {
      id: result.insertId,
      title,
      message,
      module,
      referenceType,
      referenceId,
      created_at: new Date()
    };
    for (const socket of sockets) {
      socket.emit('new_notification', notificationPayload);
    }
  }

  // TODO: Send FCM push notification using firebase-admin SDK
}

// Notify all users with a specific permission
async function notifyByPermission(permissionField, title, message, module, refType, refId) {
  const [users] = await db.query(
    `SELECT DISTINCT u.id FROM users u
     INNER JOIN user_roles ur ON ur.user_id = u.id
     INNER JOIN roles r ON r.id = ur.role_id
     WHERE r.${permissionField} = TRUE AND u.is_active = TRUE`
  );
  for (const user of users) {
    await createNotification(user.id, title, message, module, refType, refId);
  }
}

module.exports = { createNotification, notifyByPermission };
