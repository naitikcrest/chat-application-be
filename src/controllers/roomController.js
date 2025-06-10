const { validationResult } = require('express-validator');
const Room = require('../models/Room');
const User = require('../models/User');
const Message = require('../models/Message');

/**
 * Get user's rooms
 */
const getUserRooms = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    const rooms = await Room.findUserRooms(userId);

    // Calculate unread counts for each room
    const roomsWithUnread = await Promise.all(
      rooms.map(async (room) => {
        const member = room.members.find(m => m.user._id.toString() === userId.toString());
        const lastReadAt = member ? member.lastReadAt : new Date(0);
        
        const unreadCount = await Message.getUnreadCount(room._id, userId, lastReadAt);
        
        return {
          _id: room._id,
          name: room.name,
          description: room.description,
          type: room.type,
          avatar: room.avatar,
          creator: room.creator,
          memberCount: room.memberCount,
          lastActivity: room.lastActivity,
          lastMessage: room.lastMessage,
          unreadCount,
          createdAt: room.createdAt,
          // For direct messages, show the other user's info
          ...(room.type === 'direct' && {
            otherUser: room.members.find(m => m.user._id.toString() !== userId.toString())?.user
          })
        };
      })
    );

    // Apply pagination
    const startIndex = (pageNum - 1) * limitNum;
    const endIndex = startIndex + limitNum;
    const paginatedRooms = roomsWithUnread.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: {
        rooms: paginatedRooms,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(roomsWithUnread.length / limitNum),
          totalRooms: roomsWithUnread.length,
          hasNextPage: endIndex < roomsWithUnread.length,
          hasPrevPage: pageNum > 1,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('Get user rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get rooms',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get room by ID
 */
const getRoomById = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await Room.findById(roomId)
      .populate('members.user', 'username avatar status lastSeen')
      .populate('creator', 'username avatar')
      .populate('lastMessage');

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

    // Get unread count
    const member = room.members.find(m => m.user._id.toString() === userId.toString());
    const lastReadAt = member ? member.lastReadAt : new Date(0);
    const unreadCount = await Message.getUnreadCount(room._id, userId, lastReadAt);

    res.json({
      success: true,
      data: {
        room: {
          _id: room._id,
          name: room.name,
          description: room.description,
          type: room.type,
          avatar: room.avatar,
          creator: room.creator,
          members: room.members,
          settings: room.settings,
          memberCount: room.memberCount,
          lastActivity: room.lastActivity,
          lastMessage: room.lastMessage,
          unreadCount,
          createdAt: room.createdAt,
          updatedAt: room.updatedAt,
          // User's role in the room
          userRole: member?.role,
          // For direct messages, show the other user's info
          ...(room.type === 'direct' && {
            otherUser: room.members.find(m => m.user._id.toString() !== userId.toString())?.user
          })
        }
      }
    });

  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Create a new room
 */
const createRoom = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, description, type = 'group', isPrivate = false, maxMembers = 100 } = req.body;
    const userId = req.user._id;

    // Create room
    const room = new Room({
      name: name.trim(),
      description: description?.trim() || '',
      type,
      creator: userId,
      members: [{
        user: userId,
        role: 'admin',
        joinedAt: new Date(),
        lastReadAt: new Date()
      }],
      settings: {
        isPrivate,
        allowInvites: true,
        maxMembers: Math.min(maxMembers, 1000)
      }
    });

    await room.save();
    await room.populate('members.user', 'username avatar status');
    await room.populate('creator', 'username avatar');

    // Add room to user's joined rooms
    await User.findByIdAndUpdate(userId, {
      $addToSet: { joinedRooms: room._id }
    });

    res.status(201).json({
      success: true,
      message: 'Room created successfully',
      data: { room }
    });

  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update room
 */
const updateRoom = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { roomId } = req.params;
    const { name, description, avatar, settings } = req.body;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if user is admin
    if (!room.isAdmin(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    // Update room fields
    if (name !== undefined) room.name = name.trim();
    if (description !== undefined) room.description = description.trim();
    if (avatar !== undefined) room.avatar = avatar;
    if (settings) {
      if (settings.isPrivate !== undefined) room.settings.isPrivate = settings.isPrivate;
      if (settings.allowInvites !== undefined) room.settings.allowInvites = settings.allowInvites;
      if (settings.maxMembers !== undefined) {
        room.settings.maxMembers = Math.min(settings.maxMembers, 1000);
      }
    }

    await room.save();
    await room.populate('members.user', 'username avatar status');
    await room.populate('creator', 'username avatar');

    res.json({
      success: true,
      message: 'Room updated successfully',
      data: { room }
    });

  } catch (error) {
    console.error('Update room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Delete room
 */
const deleteRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Only creator can delete room
    if (room.creator.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only room creator can delete the room'
      });
    }

    // Soft delete room
    room.isActive = false;
    await room.save();

    // Remove room from all members' joined rooms
    await User.updateMany(
      { joinedRooms: roomId },
      { $pull: { joinedRooms: roomId } }
    );

    res.json({
      success: true,
      message: 'Room deleted successfully'
    });

  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Join room
 */
const joinRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room || !room.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if room is private
    if (room.settings.isPrivate) {
      return res.status(403).json({
        success: false,
        message: 'Cannot join private room without invitation'
      });
    }

    // Check if already a member
    if (room.isMember(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are already a member of this room'
      });
    }

    // Add user to room
    await room.addMember(userId);
    await room.populate('members.user', 'username avatar status');

    // Add room to user's joined rooms
    await User.findByIdAndUpdate(userId, {
      $addToSet: { joinedRooms: room._id }
    });

    res.json({
      success: true,
      message: 'Joined room successfully',
      data: { room }
    });

  } catch (error) {
    console.error('Join room error:', error);
    
    if (error.message.includes('maximum member limit')) {
      return res.status(400).json({
        success: false,
        message: 'Room has reached maximum member limit'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to join room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Leave room
 */
const leaveRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if user is a member
    if (!room.isMember(userId)) {
      return res.status(400).json({
        success: false,
        message: 'You are not a member of this room'
      });
    }

    // Creator cannot leave their own room
    if (room.creator.toString() === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Room creator cannot leave the room. Transfer ownership or delete the room instead.'
      });
    }

    // Remove user from room
    await room.removeMember(userId);

    // Remove room from user's joined rooms
    await User.findByIdAndUpdate(userId, {
      $pull: { joinedRooms: room._id }
    });

    res.json({
      success: true,
      message: 'Left room successfully'
    });

  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to leave room',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Add member to room
 */
const addMember = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { roomId } = req.params;
    const { userIdToAdd, role = 'member' } = req.body;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if current user can add members
    if (!room.isMember(userId) || (!room.settings.allowInvites && !room.isAdmin(userId))) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to add members'
      });
    }

    // Check if user to add exists
    const userToAdd = await User.findById(userIdToAdd);
    if (!userToAdd || !userToAdd.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Add user to room
    await room.addMember(userIdToAdd, role);
    await room.populate('members.user', 'username avatar status');

    // Add room to user's joined rooms
    await User.findByIdAndUpdate(userIdToAdd, {
      $addToSet: { joinedRooms: room._id }
    });

    res.json({
      success: true,
      message: 'Member added successfully',
      data: {
        newMember: {
          user: userToAdd,
          role,
          joinedAt: new Date()
        }
      }
    });

  } catch (error) {
    console.error('Add member error:', error);
    
    if (error.message.includes('already a member')) {
      return res.status(400).json({
        success: false,
        message: 'User is already a member of this room'
      });
    }
    
    if (error.message.includes('maximum member limit')) {
      return res.status(400).json({
        success: false,
        message: 'Room has reached maximum member limit'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to add member',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Remove member from room
 */
const removeMember = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userIdToRemove } = req.body;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if current user is admin
    if (!room.isAdmin(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    // Cannot remove room creator
    if (room.creator.toString() === userIdToRemove) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove room creator'
      });
    }

    // Remove user from room
    await room.removeMember(userIdToRemove);

    // Remove room from user's joined rooms
    await User.findByIdAndUpdate(userIdToRemove, {
      $pull: { joinedRooms: room._id }
    });

    res.json({
      success: true,
      message: 'Member removed successfully'
    });

  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove member',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update member role
 */
const updateMemberRole = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { roomId } = req.params;
    const { userIdToUpdate, newRole } = req.body;
    const userId = req.user._id;

    const room = await Room.findById(roomId);

    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }

    // Check if current user is admin
    if (!room.isAdmin(userId)) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    // Cannot change creator's role
    if (room.creator.toString() === userIdToUpdate) {
      return res.status(400).json({
        success: false,
        message: 'Cannot change creator role'
      });
    }

    // Update member role
    await room.updateMemberRole(userIdToUpdate, newRole);

    res.json({
      success: true,
      message: 'Member role updated successfully'
    });

  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update member role',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get public rooms
 */
const getPublicRooms = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    const rooms = await Room.findPublicRooms(pageNum, limitNum);

    res.json({
      success: true,
      data: {
        rooms: rooms.map(room => ({
          _id: room._id,
          name: room.name,
          description: room.description,
          type: room.type,
          avatar: room.avatar,
          creator: room.creator,
          memberCount: room.memberCount,
          lastActivity: room.lastActivity,
          createdAt: room.createdAt
        })),
        pagination: {
          currentPage: pageNum,
          hasNextPage: rooms.length === limitNum,
          limit: limitNum
        }
      }
    });

  } catch (error) {
    console.error('Get public rooms error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get public rooms',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Create direct message room
 */
const createDirectRoom = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userIdToChat } = req.body;
    const userId = req.user._id;

    if (userIdToChat === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot create direct message with yourself'
      });
    }

    // Check if target user exists
    const targetUser = await User.findById(userIdToChat);
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Create or get existing direct room
    const room = await Room.createDirectRoom(userId, userIdToChat);
    await room.populate('members.user', 'username avatar status');

    res.json({
      success: true,
      message: 'Direct message room created successfully',
      data: {
        room: {
          _id: room._id,
          name: targetUser.username, // For direct messages, show other user's name
          type: room.type,
          members: room.members,
          createdAt: room.createdAt,
          otherUser: {
            _id: targetUser._id,
            username: targetUser.username,
            avatar: targetUser.avatar,
            status: targetUser.status
          }
        }
      }
    });

  } catch (error) {
    console.error('Create direct room error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create direct message',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  getUserRooms,
  getRoomById,
  createRoom,
  updateRoom,
  deleteRoom,
  joinRoom,
  leaveRoom,
  addMember,
  removeMember,
  updateMemberRole,
  getPublicRooms,
  createDirectRoom
};

