const { socketAuth } = require('../middleware/auth');
const chatHandlers = require('./chatHandlers');
const roomHandlers = require('./roomHandlers');
const userHandlers = require('./userHandlers');

// Store active connections
const activeConnections = new Map();

/**
 * Main socket handler
 * @param {SocketIO.Server} io - Socket.IO server instance
 */
const socketHandlers = (io) => {
  // Authentication middleware for all socket connections
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId = socket.userId;
    const user = socket.user;

    console.log(`🔌 User connected: ${user.username} (${userId})`);

    // Store connection
    activeConnections.set(userId, {
      socketId: socket.id,
      user: user,
      connectedAt: new Date()
    });

    // Join user to their personal room for direct messages
    socket.join(`user:${userId}`);

    // Update user status to online
    user.updateStatus('online').catch(console.error);

    // Emit user online status to all connected users
    socket.broadcast.emit('user:status', {
      userId: userId,
      status: 'online',
      lastSeen: new Date()
    });

    // Register event handlers
    chatHandlers(socket, io);
    roomHandlers(socket, io);
    userHandlers(socket, io);

    // Handle typing events
    socket.on('typing:start', (data) => {
      const { roomId } = data;
      socket.to(roomId).emit('typing:start', {
        userId: userId,
        username: user.username,
        roomId: roomId
      });
    });

    socket.on('typing:stop', (data) => {
      const { roomId } = data;
      socket.to(roomId).emit('typing:stop', {
        userId: userId,
        username: user.username,
        roomId: roomId
      });
    });

    // Handle user status updates
    socket.on('status:update', async (data) => {
      try {
        const { status } = data;
        
        if (!['online', 'away', 'busy'].includes(status)) {
          socket.emit('error', { message: 'Invalid status' });
          return;
        }

        await user.updateStatus(status);
        
        // Broadcast status update
        io.emit('user:status', {
          userId: userId,
          status: status,
          lastSeen: new Date()
        });

        socket.emit('status:updated', { status });
      } catch (error) {
        console.error('Status update error:', error);
        socket.emit('error', { message: 'Failed to update status' });
      }
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // Handle disconnection
    socket.on('disconnect', async (reason) => {
      console.log(`🔌 User disconnected: ${user.username} (${reason})`);

      try {
        // Remove from active connections
        activeConnections.delete(userId);

        // Update user status to offline
        await user.updateStatus('offline');

        // Emit user offline status
        socket.broadcast.emit('user:status', {
          userId: userId,
          status: 'offline',
          lastSeen: new Date()
        });

        // Leave all rooms
        const rooms = Array.from(socket.rooms);
        rooms.forEach(room => {
          if (room !== socket.id) {
            socket.leave(room);
          }
        });

      } catch (error) {
        console.error('Disconnect cleanup error:', error);
      }
    });

    // Handle connection errors
    socket.on('error', (error) => {
      console.error(`Socket error for user ${userId}:`, error);
    });

    // Send initial data to newly connected user
    socket.emit('connection:established', {
      userId: userId,
      user: user.profile,
      connectedAt: new Date(),
      activeUsers: getActiveUsers()
    });
  });

  // Handle server-level events
  io.engine.on('connection_error', (err) => {
    console.error('Connection error:', err.req);
    console.error('Error code:', err.code);
    console.error('Error message:', err.message);
    console.error('Error context:', err.context);
  });

  return io;
};

/**
 * Get list of active users
 * @returns {Array} Array of active user objects
 */
const getActiveUsers = () => {
  return Array.from(activeConnections.values()).map(conn => ({
    userId: conn.user._id,
    username: conn.user.username,
    avatar: conn.user.avatar,
    status: conn.user.status,
    connectedAt: conn.connectedAt
  }));
};

/**
 * Get active connection by user ID
 * @param {String} userId - User ID
 * @returns {Object|null} Connection object or null
 */
const getActiveConnection = (userId) => {
  return activeConnections.get(userId) || null;
};

/**
 * Check if user is online
 * @param {String} userId - User ID
 * @returns {Boolean} True if user is online
 */
const isUserOnline = (userId) => {
  return activeConnections.has(userId);
};

/**
 * Send message to specific user
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {String} userId - Target user ID
 * @param {String} event - Event name
 * @param {Object} data - Event data
 */
const sendToUser = (io, userId, event, data) => {
  const connection = getActiveConnection(userId);
  if (connection) {
    io.to(connection.socketId).emit(event, data);
    return true;
  }
  return false;
};

/**
 * Send message to multiple users
 * @param {SocketIO.Server} io - Socket.IO server instance
 * @param {Array} userIds - Array of user IDs
 * @param {String} event - Event name
 * @param {Object} data - Event data
 */
const sendToUsers = (io, userIds, event, data) => {
  const sentTo = [];
  userIds.forEach(userId => {
    if (sendToUser(io, userId, event, data)) {
      sentTo.push(userId);
    }
  });
  return sentTo;
};

/**
 * Get connection statistics
 * @returns {Object} Connection statistics
 */
const getConnectionStats = () => {
  return {
    totalConnections: activeConnections.size,
    activeUsers: getActiveUsers(),
    connectionsByStatus: getActiveUsers().reduce((acc, user) => {
      acc[user.status] = (acc[user.status] || 0) + 1;
      return acc;
    }, {})
  };
};

module.exports = socketHandlers;

// Export utility functions for use in other modules
module.exports.utils = {
  getActiveUsers,
  getActiveConnection,
  isUserOnline,
  sendToUser,
  sendToUsers,
  getConnectionStats
};

