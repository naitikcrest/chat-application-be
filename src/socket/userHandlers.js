const User = require('../models/User');
const { getActiveUsers, isUserOnline } = require('./socketHandlers').utils;

/**
 * User-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {SocketIO.Server} io - Socket.IO server instance
 */
const userHandlers = (socket, io) => {
  const userId = socket.userId;
  const user = socket.user;

  /**
   * Get list of online users
   */
  socket.on('users:online', () => {
    try {
      const activeUsers = getActiveUsers();
      
      socket.emit('users:online', {
        users: activeUsers.filter(activeUser => activeUser.userId !== userId)
      });
    } catch (error) {
      console.error('Get online users error:', error);
      socket.emit('error', { message: 'Failed to get online users' });
    }
  });

  /**
   * Search for users
   */
  socket.on('users:search', async (data) => {
    try {
      const { query, limit = 20 } = data;

      if (!query || query.trim().length < 2) {
        socket.emit('error', { message: 'Search query must be at least 2 characters' });
        return;
      }

      const users = await User.searchUsers(query.trim(), userId);
      
      // Add online status to search results
      const usersWithStatus = users.map(searchUser => ({
        _id: searchUser._id,
        username: searchUser.username,
        email: searchUser.email,
        avatar: searchUser.avatar,
        bio: searchUser.bio,
        status: searchUser.status,
        lastSeen: searchUser.lastSeen,
        isOnline: isUserOnline(searchUser._id.toString())
      }));

      socket.emit('users:search:results', {
        query: query.trim(),
        users: usersWithStatus.slice(0, limit)
      });

    } catch (error) {
      console.error('Search users error:', error);
      socket.emit('error', { message: 'Failed to search users' });
    }
  });

  /**
   * Get user profile
   */
  socket.on('user:profile', async (data) => {
    try {
      const { userIdToGet } = data;

      if (!userIdToGet) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      const targetUser = await User.findById(userIdToGet)
        .select('username email avatar bio status lastSeen createdAt');

      if (!targetUser || !targetUser.isActive) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      socket.emit('user:profile', {
        user: {
          _id: targetUser._id,
          username: targetUser.username,
          email: targetUser.email,
          avatar: targetUser.avatar,
          bio: targetUser.bio,
          status: targetUser.status,
          lastSeen: targetUser.lastSeen,
          isOnline: isUserOnline(targetUser._id.toString()),
          memberSince: targetUser.createdAt
        }
      });

    } catch (error) {
      console.error('Get user profile error:', error);
      socket.emit('error', { message: 'Failed to get user profile' });
    }
  });

  /**
   * Add user to friends list
   */
  socket.on('user:add_friend', async (data) => {
    try {
      const { userIdToAdd } = data;

      if (!userIdToAdd) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      if (userIdToAdd === userId) {
        socket.emit('error', { message: 'Cannot add yourself as friend' });
        return;
      }

      // Check if target user exists
      const targetUser = await User.findById(userIdToAdd);
      if (!targetUser || !targetUser.isActive) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Check if already friends
      const currentUser = await User.findById(userId);
      const isAlreadyFriend = currentUser.friends.some(
        friend => friend.user.toString() === userIdToAdd
      );

      if (isAlreadyFriend) {
        socket.emit('error', { message: 'User is already in your friends list' });
        return;
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

      // Notify target user about friend request/addition
      const { sendToUser } = require('./socketHandlers').utils;
      sendToUser(io, userIdToAdd, 'user:friend_added', {
        friend: {
          _id: userId,
          username: user.username,
          avatar: user.avatar,
          status: user.status
        },
        addedAt: new Date()
      });

      socket.emit('user:add_friend:success', {
        friend: {
          _id: targetUser._id,
          username: targetUser.username,
          avatar: targetUser.avatar,
          status: targetUser.status,
          isOnline: isUserOnline(targetUser._id.toString())
        }
      });

    } catch (error) {
      console.error('Add friend error:', error);
      socket.emit('error', { message: 'Failed to add friend' });
    }
  });

  /**
   * Remove user from friends list
   */
  socket.on('user:remove_friend', async (data) => {
    try {
      const { userIdToRemove } = data;

      if (!userIdToRemove) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      const currentUser = await User.findById(userId);
      
      // Remove from current user's friends list
      currentUser.friends = currentUser.friends.filter(
        friend => friend.user.toString() !== userIdToRemove
      );
      await currentUser.save();

      // Remove current user from target user's friends list
      await User.findByIdAndUpdate(userIdToRemove, {
        $pull: { friends: { user: userId } }
      });

      // Notify target user about friend removal
      const { sendToUser } = require('./socketHandlers').utils;
      sendToUser(io, userIdToRemove, 'user:friend_removed', {
        removedBy: {
          _id: userId,
          username: user.username
        }
      });

      socket.emit('user:remove_friend:success', {
        removedUserId: userIdToRemove
      });

    } catch (error) {
      console.error('Remove friend error:', error);
      socket.emit('error', { message: 'Failed to remove friend' });
    }
  });

  /**
   * Get friends list
   */
  socket.on('user:friends', async () => {
    try {
      const currentUser = await User.findById(userId)
        .populate('friends.user', 'username avatar status lastSeen');

      const friendsWithStatus = currentUser.friends.map(friendship => ({
        _id: friendship.user._id,
        username: friendship.user.username,
        avatar: friendship.user.avatar,
        status: friendship.user.status,
        lastSeen: friendship.user.lastSeen,
        isOnline: isUserOnline(friendship.user._id.toString()),
        addedAt: friendship.addedAt
      }));

      socket.emit('user:friends', {
        friends: friendsWithStatus
      });

    } catch (error) {
      console.error('Get friends error:', error);
      socket.emit('error', { message: 'Failed to get friends list' });
    }
  });

  /**
   * Block user
   */
  socket.on('user:block', async (data) => {
    try {
      const { userIdToBlock } = data;

      if (!userIdToBlock) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      if (userIdToBlock === userId) {
        socket.emit('error', { message: 'Cannot block yourself' });
        return;
      }

      // Check if target user exists
      const targetUser = await User.findById(userIdToBlock);
      if (!targetUser) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      const currentUser = await User.findById(userId);

      // Check if already blocked
      if (currentUser.blockedUsers.includes(userIdToBlock)) {
        socket.emit('error', { message: 'User is already blocked' });
        return;
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

      socket.emit('user:block:success', {
        blockedUserId: userIdToBlock,
        blockedUsername: targetUser.username
      });

    } catch (error) {
      console.error('Block user error:', error);
      socket.emit('error', { message: 'Failed to block user' });
    }
  });

  /**
   * Unblock user
   */
  socket.on('user:unblock', async (data) => {
    try {
      const { userIdToUnblock } = data;

      if (!userIdToUnblock) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      const currentUser = await User.findById(userId);

      // Remove from blocked users list
      currentUser.blockedUsers = currentUser.blockedUsers.filter(
        blockedUserId => blockedUserId.toString() !== userIdToUnblock
      );

      await currentUser.save();

      socket.emit('user:unblock:success', {
        unblockedUserId: userIdToUnblock
      });

    } catch (error) {
      console.error('Unblock user error:', error);
      socket.emit('error', { message: 'Failed to unblock user' });
    }
  });

  /**
   * Get blocked users list
   */
  socket.on('user:blocked', async () => {
    try {
      const currentUser = await User.findById(userId)
        .populate('blockedUsers', 'username avatar');

      socket.emit('user:blocked', {
        blockedUsers: currentUser.blockedUsers.map(blockedUser => ({
          _id: blockedUser._id,
          username: blockedUser.username,
          avatar: blockedUser.avatar
        }))
      });

    } catch (error) {
      console.error('Get blocked users error:', error);
      socket.emit('error', { message: 'Failed to get blocked users' });
    }
  });

  /**
   * Update user presence/activity
   */
  socket.on('user:activity', async (data) => {
    try {
      const { activity } = data; // 'typing', 'idle', 'active', etc.

      // Update last seen
      await user.updateLastSeen();

      // Broadcast activity to friends or relevant users
      // This could be used for showing "last seen" or activity indicators
      
      socket.emit('user:activity:updated', {
        activity,
        timestamp: new Date()
      });

    } catch (error) {
      console.error('Update activity error:', error);
      socket.emit('error', { message: 'Failed to update activity' });
    }
  });
};

module.exports = userHandlers;

