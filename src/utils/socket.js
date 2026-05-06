const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const db = require('../db/connection');

// Maintain a map of userId -> socket instances
const userSockets = new Map();

let io;

function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: '*', // Adjust to specific origin if needed
      methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
  });

  // Authentication Middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.user.userId;
    console.log(`Socket connected: User ${userId} (Socket ID: ${socket.id})`);

    // Store the socket for this user
    if (!userSockets.has(userId)) {
      userSockets.set(userId, new Set());
    }
    userSockets.get(userId).add(socket);

    // Sync missed notifications
    db.query(
      'SELECT * FROM notifications WHERE user_id = ? AND is_read = FALSE ORDER BY created_at ASC',
      [userId]
    ).then(([unread]) => {
      if (unread && unread.length > 0) {
        unread.forEach(notification => {
          socket.emit('new_notification', notification);
        });
      }
    }).catch(err => console.error('Socket DB Error:', err));

    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: User ${userId} (Socket ID: ${socket.id}). Reason: ${reason}`);
      if (userSockets.has(userId)) {
        userSockets.get(userId).delete(socket);
        if (userSockets.get(userId).size === 0) {
          userSockets.delete(userId);
        }
      }
    });
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error('Socket.io is not initialized!');
  }
  return io;
}

function getUserSockets(userId) {
  return userSockets.get(userId) || new Set();
}

module.exports = {
  initSocket,
  getIo,
  getUserSockets
};
