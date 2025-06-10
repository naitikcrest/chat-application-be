const { validationResult } = require('express-validator');
const Message = require('../models/Message');
const Room = require('../models/Room');

/**
 * Get messages for a room with pagination
 */
const getRoomMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.user._id;

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    // Check if room exists and user is a member
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    if (!room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this room'
      });
    }

    // Get messages
    const messages = await Message.getRoomMessages(roomId, pageNum, limitNum);
    
    // Get total count for pagination info
    const totalMessages = await Message.countDocuments({
      room: roomId,
      isDeleted: false
    });

    const totalPages = Math.ceil(totalMessages / limitNum);
    const hasNextPage = pageNum < totalPages;
    const hasPrevPage = pageNum > 1;

    res.json({
      success: true,
      data: {
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalMessages,
          hasNextPage,
          hasPrevPage,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('Get room messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Search messages in a room
 */
const searchMessages = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { q: query, page = 1, limit = 20 } = req.query;
    const userId = req.user._id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    // Validate pagination parameters
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    // Check if room exists and user is a member
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    if (!room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this room'
      });
    }

    // Search messages
    const messages = await Message.searchMessages(roomId, query.trim(), pageNum, limitNum);
    
    // Get total count for the search
    const searchRegex = new RegExp(query.trim(), 'i');
    const totalResults = await Message.countDocuments({
      room: roomId,
      content: searchRegex,
      isDeleted: false
    });

    const totalPages = Math.ceil(totalResults / limitNum);

    res.json({
      success: true,
      data: {
        messages,
        query: query.trim(),
        pagination: {
          currentPage: pageNum,
          totalPages,
          totalResults,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('Search messages error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search messages',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get message by ID
 */
const getMessageById = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId)
      .populate('sender', 'username avatar status')
      .populate('metadata.replyTo', 'content sender')
      .populate('readBy.user', 'username');

    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is a member of the room
    const room = await Room.findById(message.room);
    if (!room || !room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: { message }
    });

  } catch (error) {
    console.error('Get message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update message (edit)
 */
const updateMessage = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { messageId } = req.params;
    const { content } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is the sender
    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You can only edit your own messages'
      });
    }

    // Check if message is not too old (15 minutes)
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    if (message.createdAt < fifteenMinutesAgo) {
      return res.status(400).json({
        success: false,
        message: 'Message is too old to edit'
      });
    }

    // Edit message
    await message.editContent(content.trim(), userId);
    await message.populate('sender', 'username avatar status');

    res.json({
      success: true,
      message: 'Message updated successfully',
      data: { message }
    });

  } catch (error) {
    console.error('Update message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete message
 */
const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is the sender or room admin
    const room = await Room.findById(message.room);
    const canDelete = message.sender.toString() === userId.toString() || room.isAdmin(userId);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You can only delete your own messages'
      });
    }

    // Soft delete message
    await message.softDelete(userId);

    res.json({
      success: true,
      message: 'Message deleted successfully'
    });

  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Add reaction to message
 */
const addReaction = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Check if user is a member of the room
    const room = await Room.findById(message.room);
    if (!room || !room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Add reaction
    await message.addReaction(emoji, userId);

    res.json({
      success: true,
      message: 'Reaction added successfully',
      data: {
        reactions: message.reactions
      }
    });

  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Remove reaction from message
 */
const removeReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);

    if (!message || message.isDeleted) {
      return res.status(404).json({
        success: false,
        message: 'Message not found'
      });
    }

    // Remove reaction
    await message.removeReaction(emoji, userId);

    res.json({
      success: true,
      message: 'Reaction removed successfully',
      data: {
        reactions: message.reactions
      }
    });

  } catch (error) {
    console.error('Remove reaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove reaction',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Mark messages as read
 */
const markAsRead = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { messageIds } = req.body;
    const userId = req.user._id;

    // Check if room exists and user is a member
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    if (!room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this room'
      });
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

    res.json({
      success: true,
      message: 'Messages marked as read'
    });

  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark messages as read',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get unread message count for a room
 */
const getUnreadCount = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    // Check if room exists and user is a member
    const room = await Room.findById(roomId);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    if (!room.isMember(userId)) {
      return res.status(403).json({
        success: false,
        message: 'You are not a member of this room'
      });
    }

    // Get user's last read timestamp
    const member = room.members.find(m => m.user.toString() === userId.toString());
    const lastReadAt = member ? member.lastReadAt : new Date(0);

    // Get unread count
    const unreadCount = await Message.getUnreadCount(roomId, userId, lastReadAt);

    res.json({
      success: true,
      data: {
        roomId,
        unreadCount,
        lastReadAt
      }
    });

  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get unread count',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getRoomMessages,
  searchMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markAsRead,
  getUnreadCount
};

