const { validationResult } = require('express-validator');
const User = require('../models/User');

/**
 * Search users
 */
const searchUsers = async (req, res) => {
  try {
    const { q: query, limit = 20 } = req.query;
    const userId = req.user._id;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Search query must be at least 2 characters'
      });
    }

    const limitNum = Math.min(50, Math.max(1, parseInt(limit)));

    const users = await User.searchUsers(query.trim(), userId);

    // Filter out blocked users
    const currentUser = await User.findById(userId).select('blockedUsers');
    const blockedUserIds = currentUser.blockedUsers.map(id => id.toString());

    const filteredUsers = users
      .filter(user => !blockedUserIds.includes(user._id.toString()))
      .slice(0, limitNum);

    res.json({
      success: true,
      data: {
        users: filteredUsers.map(user => ({
          _id: user._id,
          username: user.username,
          email: user.email,
          avatar: user.avatar,
          bio: user.bio,
          status: user.status,
          lastSeen: user.lastSeen
        })),
        query: query.trim(),
        total: filteredUsers.length
      }
    });

  } catch (error) {
    console.error('Search users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user by ID
 */
const getUserById = async (req, res) => {
  try {
    const { userId: targetUserId } = req.params;
    const userId = req.user._id;

    const targetUser = await User.findById(targetUserId)
      .select('username email avatar bio status lastSeen createdAt');

    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if current user has blocked the target user
    const currentUser = await User.findById(userId).select('blockedUsers');
    const isBlocked = currentUser.blockedUsers.includes(targetUserId);

    if (isBlocked) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          _id: targetUser._id,
          username: targetUser.username,
          email: targetUser.email,
          avatar: targetUser.avatar,
          bio: targetUser.bio,
          status: targetUser.status,
          lastSeen: targetUser.lastSeen,
          memberSince: targetUser.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get online users
 */
const getOnlineUsers = async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const userId = req.user._id;

    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

    const onlineUsers = await User.findOnlineUsers();

    // Filter out current user and blocked users
    const currentUser = await User.findById(userId).select('blockedUsers');
    const blockedUserIds = currentUser.blockedUsers.map(id => id.toString());

    const filteredUsers = onlineUsers
      .filter(user => 
        user._id.toString() !== userId.toString() && 
        !blockedUserIds.includes(user._id.toString())
      )
      .slice(0, limitNum);

    res.json({
      success: true,
      data: {
        users: filteredUsers.map(user => ({
          _id: user._id,
          username: user.username,
          avatar: user.avatar,
          status: user.status,
          lastSeen: user.lastSeen
        })),
        total: filteredUsers.length
      }
    });

  } catch (error) {
    console.error('Get online users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get online users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's friends
 */
const getFriends = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId)
      .populate('friends.user', 'username avatar status lastSeen');

    const friends = user.friends.map(friendship => ({
      _id: friendship.user._id,
      username: friendship.user.username,
      avatar: friendship.user.avatar,
      status: friendship.user.status,
      lastSeen: friendship.user.lastSeen,
      addedAt: friendship.addedAt
    }));

    res.json({
      success: true,
      data: {
        friends,
        total: friends.length
      }
    });

  } catch (error) {
    console.error('Get friends error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get friends',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Add friend
 */
const addFriend = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userIdToAdd } = req.body;
    const userId = req.user._id;

    if (userIdToAdd === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add yourself as friend'
      });
    }

    // Check if target user exists
    const targetUser = await User.findById(userIdToAdd);
    if (!targetUser || !targetUser.isActive) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if already friends
    const currentUser = await User.findById(userId);
    const isAlreadyFriend = currentUser.friends.some(
      friend => friend.user.toString() === userIdToAdd
    );

    if (isAlreadyFriend) {
      return res.status(400).json({
        success: false,
        message: 'User is already in your friends list'
      });
    }

    // Check if user is blocked
    if (currentUser.blockedUsers.includes(userIdToAdd)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add blocked user as friend'
      });
    }

    // Add to friends list
    currentUser.friends.push({
      user: userIdToAdd,
      addedAt: new Date()
    });
    await currentUser.save();

    // Optionally add current user to target user's friends list (mutual friendship)
    targetUser.friends.push({
      user: userId,
      addedAt: new Date()
    });
    await targetUser.save();

    res.json({
      success: true,
      message: 'Friend added successfully',
      data: {
        friend: {
          _id: targetUser._id,
          username: targetUser.username,
          avatar: targetUser.avatar,
          status: targetUser.status,
          addedAt: new Date()
        }
      }
    });

  } catch (error) {
    console.error('Add friend error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add friend',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Remove friend
 */
const removeFriend = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userIdToRemove } = req.body;
    const userId = req.user._id;

    const currentUser = await User.findById(userId);
    
    // Check if user is in friends list
    const friendIndex = currentUser.friends.findIndex(
      friend => friend.user.toString() === userIdToRemove
    );

    if (friendIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'User is not in your friends list'
      });
    }

    // Remove from current user's friends list
    currentUser.friends.splice(friendIndex, 1);
    await currentUser.save();

    // Remove current user from target user's friends list
    await User.findByIdAndUpdate(userIdToRemove, {
      $pull: { friends: { user: userId } }
    });

    res.json({
      success: true,
      message: 'Friend removed successfully'
    });

  } catch (error) {
    console.error('Remove friend error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove friend',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Block user
 */
const blockUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userIdToBlock } = req.body;
    const userId = req.user._id;

    if (userIdToBlock === userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot block yourself'
      });
    }

    // Check if target user exists
    const targetUser = await User.findById(userIdToBlock);
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentUser = await User.findById(userId);

    // Check if already blocked
    if (currentUser.blockedUsers.includes(userIdToBlock)) {
      return res.status(400).json({
        success: false,
        message: 'User is already blocked'
      });
    }

    // Add to blocked users list
    currentUser.blockedUsers.push(userIdToBlock);

    // Remove from friends list if they were friends
    currentUser.friends = currentUser.friends.filter(
      friend => friend.user.toString() !== userIdToBlock
    );

    await currentUser.save();

    // Remove current user from target user's friends list
    await User.findByIdAndUpdate(userIdToBlock, {
      $pull: { friends: { user: userId } }
    });

    res.json({
      success: true,
      message: 'User blocked successfully'
    });

  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to block user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Unblock user
 */
const unblockUser = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userIdToUnblock } = req.body;
    const userId = req.user._id;

    const currentUser = await User.findById(userId);

    // Check if user is blocked
    const blockedIndex = currentUser.blockedUsers.findIndex(
      blockedUserId => blockedUserId.toString() === userIdToUnblock
    );

    if (blockedIndex === -1) {
      return res.status(400).json({
        success: false,
        message: 'User is not blocked'
      });
    }

    // Remove from blocked users list
    currentUser.blockedUsers.splice(blockedIndex, 1);
    await currentUser.save();

    res.json({
      success: true,
      message: 'User unblocked successfully'
    });

  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unblock user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get blocked users
 */
const getBlockedUsers = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId)
      .populate('blockedUsers', 'username avatar');

    const blockedUsers = user.blockedUsers.map(blockedUser => ({
      _id: blockedUser._id,
      username: blockedUser.username,
      avatar: blockedUser.avatar
    }));

    res.json({
      success: true,
      data: {
        blockedUsers,
        total: blockedUsers.length
      }
    });

  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get blocked users',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update user status
 */
const updateStatus = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { status } = req.body;
    const user = req.user;

    await user.updateStatus(status);

    res.json({
      success: true,
      message: 'Status updated successfully',
      data: {
        status: user.status,
        lastSeen: user.lastSeen
      }
    });

  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  searchUsers,
  getUserById,
  getOnlineUsers,
  getFriends,
  addFriend,
  removeFriend,
  blockUser,
  unblockUser,
  getBlockedUsers,
  updateStatus
};

