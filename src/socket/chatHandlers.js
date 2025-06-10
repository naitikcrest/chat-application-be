const Message = require('../models/Message');
const Room = require('../models/Room');
const { isUserOnline, sendToUser } = require('./socketHandlers').utils;

/**
 * Chat-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {SocketIO.Server} io - Socket.IO server instance
 */
const chatHandlers = (socket, io) => {
  const userId = socket.userId;
  const user = socket.user;

  /**
   * Send a message to a room
   */
  socket.on('message:send', async (data) => {
    try {
      const { roomId, content, type = 'text', metadata = {} } = data;

      // Validate input
      if (!roomId || !content || content.trim().length === 0) {
        socket.emit('error', { message: 'Room ID and content are required' });
        return;
      }

      if (content.length > 2000) {
        socket.emit('error', { message: 'Message too long (max 2000 characters)' });
        return;
      }

      // Check if room exists and user is a member
      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      if (!room.isMember(userId)) {
        socket.emit('error', { message: 'You are not a member of this room' });
        return;
      }

      // Create message
      const message = new Message({
        content: content.trim(),
        sender: userId,
        room: roomId,
        type,
        metadata
      });

      await message.save();

      // Populate sender information
      await message.populate('sender', 'username avatar status');

      // Update room's last message and activity
      room.lastMessage = message._id;
      room.lastActivity = new Date();
      await room.save();

      // Prepare message data for emission
      const messageData = {
        _id: message._id,
        content: message.content,
        sender: message.sender,
        room: message.room,
        type: message.type,
        metadata: message.metadata,
        reactions: message.reactions,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt
      };

      // Send message to all room members
      io.to(roomId).emit('message:new', messageData);

      // Send push notification to offline users (if needed)
      const offlineMembers = room.members.filter(member => 
        member.user.toString() !== userId && !isUserOnline(member.user.toString())
      );

      // Here you could integrate with a push notification service
      // for offline members

      // Acknowledge message sent
      socket.emit('message:sent', {
        tempId: data.tempId, // Client-side temporary ID for optimistic updates
        message: messageData
      });

    } catch (error) {
      console.error('Send message error:', error);
      socket.emit('error', { 
        message: 'Failed to send message',
        tempId: data.tempId 
      });
    }
  });

  /**
   * Edit a message
   */
  socket.on('message:edit', async (data) => {
    try {
      const { messageId, content } = data;

      if (!messageId || !content || content.trim().length === 0) {
        socket.emit('error', { message: 'Message ID and content are required' });
        return;
      }

      const message = await Message.findById(messageId)
        .populate('sender', 'username avatar status');

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Check if user is the sender
      if (message.sender._id.toString() !== userId) {
        socket.emit('error', { message: 'You can only edit your own messages' });
        return;
      }

      // Check if message is not too old (e.g., 15 minutes)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (message.createdAt < fifteenMinutesAgo) {
        socket.emit('error', { message: 'Message is too old to edit' });
        return;
      }

      // Edit message
      await message.editContent(content.trim(), userId);

      // Emit updated message to room
      io.to(message.room.toString()).emit('message:edited', {
        messageId: message._id,
        content: message.content,
        editedAt: message.metadata.editedAt,
        editHistory: message.metadata.editHistory
      });

      socket.emit('message:edit:success', { messageId });

    } catch (error) {
      console.error('Edit message error:', error);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  /**
   * Delete a message
   */
  socket.on('message:delete', async (data) => {
    try {
      const { messageId } = data;

      if (!messageId) {
        socket.emit('error', { message: 'Message ID is required' });
        return;
      }

      const message = await Message.findById(messageId);

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Check if user is the sender or room admin
      const room = await Room.findById(message.room);
      const canDelete = message.sender.toString() === userId || room.isAdmin(userId);

      if (!canDelete) {
        socket.emit('error', { message: 'You can only delete your own messages' });
        return;
      }

      // Soft delete message
      await message.softDelete(userId);

      // Emit deleted message to room
      io.to(message.room.toString()).emit('message:deleted', {
        messageId: message._id,
        deletedBy: userId,
        deletedAt: message.deletedAt
      });

      socket.emit('message:delete:success', { messageId });

    } catch (error) {
      console.error('Delete message error:', error);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  /**
   * Add reaction to a message
   */
  socket.on('message:react', async (data) => {
    try {
      const { messageId, emoji } = data;

      if (!messageId || !emoji) {
        socket.emit('error', { message: 'Message ID and emoji are required' });
        return;
      }

      const message = await Message.findById(messageId);

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Check if user is a member of the room
      const room = await Room.findById(message.room);
      if (!room.isMember(userId)) {
        socket.emit('error', { message: 'You are not a member of this room' });
        return;
      }

      // Add reaction
      await message.addReaction(emoji, userId);

      // Emit reaction update to room
      io.to(message.room.toString()).emit('message:reaction:added', {
        messageId: message._id,
        emoji,
        userId,
        username: user.username,
        reactions: message.reactions
      });

    } catch (error) {
      console.error('Add reaction error:', error);
      socket.emit('error', { message: 'Failed to add reaction' });
    }
  });

  /**
   * Remove reaction from a message
   */
  socket.on('message:unreact', async (data) => {
    try {
      const { messageId, emoji } = data;

      if (!messageId || !emoji) {
        socket.emit('error', { message: 'Message ID and emoji are required' });
        return;
      }

      const message = await Message.findById(messageId);

      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      // Remove reaction
      await message.removeReaction(emoji, userId);

      // Emit reaction update to room
      io.to(message.room.toString()).emit('message:reaction:removed', {
        messageId: message._id,
        emoji,
        userId,
        username: user.username,
        reactions: message.reactions
      });

    } catch (error) {
      console.error('Remove reaction error:', error);
      socket.emit('error', { message: 'Failed to remove reaction' });
    }
  });

  /**
   * Mark messages as read
   */
  socket.on('messages:mark_read', async (data) => {
    try {
      const { roomId, messageIds } = data;

      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      // Check if user is a member of the room
      const room = await Room.findById(roomId);
      if (!room || !room.isMember(userId)) {
        socket.emit('error', { message: 'Room not found or access denied' });
        return;
      }

      // Update last read timestamp for the user in the room
      await room.updateLastRead(userId);

      // If specific message IDs provided, mark them as read
      if (messageIds && messageIds.length > 0) {
        await Message.updateMany(
          { 
            _id: { $in: messageIds },
            room: roomId,
            'readBy.user': { $ne: userId }
          },
          { 
            $push: { 
              readBy: { 
                user: userId, 
                readAt: new Date() 
              } 
            } 
          }
        );
      }

      // Emit read status update to room members
      socket.to(roomId).emit('messages:read', {
        userId,
        roomId,
        readAt: new Date(),
        messageIds: messageIds || []
      });

      socket.emit('messages:mark_read:success', { roomId });

    } catch (error) {
      console.error('Mark messages read error:', error);
      socket.emit('error', { message: 'Failed to mark messages as read' });
    }
  });

  /**
   * Get message history for a room
   */
  socket.on('messages:history', async (data) => {
    try {
      const { roomId, page = 1, limit = 50 } = data;

      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      // Check if user is a member of the room
      const room = await Room.findById(roomId);
      if (!room || !room.isMember(userId)) {
        socket.emit('error', { message: 'Room not found or access denied' });
        return;
      }

      // Get messages
      const messages = await Message.getRoomMessages(roomId, page, Math.min(limit, 100));

      socket.emit('messages:history', {
        roomId,
        messages: messages.reverse(), // Reverse to show oldest first
        page,
        hasMore: messages.length === Math.min(limit, 100)
      });

    } catch (error) {
      console.error('Get message history error:', error);
      socket.emit('error', { message: 'Failed to get message history' });
    }
  });

  /**
   * Search messages in a room
   */
  socket.on('messages:search', async (data) => {
    try {
      const { roomId, query, page = 1, limit = 20 } = data;

      if (!roomId || !query) {
        socket.emit('error', { message: 'Room ID and search query are required' });
        return;
      }

      // Check if user is a member of the room
      const room = await Room.findById(roomId);
      if (!room || !room.isMember(userId)) {
        socket.emit('error', { message: 'Room not found or access denied' });
        return;
      }

      // Search messages
      const messages = await Message.searchMessages(roomId, query, page, limit);

      socket.emit('messages:search:results', {
        roomId,
        query,
        messages,
        page,
        hasMore: messages.length === limit
      });

    } catch (error) {
      console.error('Search messages error:', error);
      socket.emit('error', { message: 'Failed to search messages' });
    }
  });
};

module.exports = chatHandlers;

