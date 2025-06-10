const Room = require('../models/Room');
const User = require('../models/User');
const { sendToUser } = require('./socketHandlers').utils;

/**
 * Room-related socket event handlers
 * @param {Socket} socket - Socket instance
 * @param {SocketIO.Server} io - Socket.IO server instance
 */
const roomHandlers = (socket, io) => {
  const userId = socket.userId;
  const user = socket.user;

  /**
   * Join a room
   */
  socket.on('room:join', async (data) => {
    try {
      const { roomId } = data;

      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      const room = await Room.findById(roomId)
        .populate('members.user', 'username avatar status')
        .populate('creator', 'username avatar');

      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if user is a member
      if (!room.isMember(userId)) {
        socket.emit('error', { message: 'You are not a member of this room' });
        return;
      }

      // Join socket room
      socket.join(roomId);

      // Update user's last read timestamp
      await room.updateLastRead(userId);

      // Emit to other room members that user joined
      socket.to(roomId).emit('room:user_joined', {
        roomId,
        user: {
          _id: userId,
          username: user.username,
          avatar: user.avatar,
          status: user.status
        },
        joinedAt: new Date()
      });

      // Send room info to user
      socket.emit('room:joined', {
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
          createdAt: room.createdAt
        }
      });

    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  /**
   * Leave a room
   */
  socket.on('room:leave', async (data) => {
    try {
      const { roomId } = data;

      if (!roomId) {
        socket.emit('error', { message: 'Room ID is required' });
        return;
      }

      // Leave socket room
      socket.leave(roomId);

      // Emit to other room members that user left
      socket.to(roomId).emit('room:user_left', {
        roomId,
        user: {
          _id: userId,
          username: user.username,
          avatar: user.avatar
        },
        leftAt: new Date()
      });

      socket.emit('room:left', { roomId });

    } catch (error) {
      console.error('Leave room error:', error);
      socket.emit('error', { message: 'Failed to leave room' });
    }
  });

  /**
   * Create a new room
   */
  socket.on('room:create', async (data) => {
    try {
      const { name, description, type = 'group', isPrivate = false, maxMembers = 100 } = data;

      if (!name || name.trim().length === 0) {
        socket.emit('error', { message: 'Room name is required' });
        return;
      }

      if (name.length > 50) {
        socket.emit('error', { message: 'Room name too long (max 50 characters)' });
        return;
      }

      if (description && description.length > 200) {
        socket.emit('error', { message: 'Description too long (max 200 characters)' });
        return;
      }

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

      // Join socket room
      socket.join(room._id.toString());

      // Add room to user's joined rooms
      await User.findByIdAndUpdate(userId, {
        $addToSet: { joinedRooms: room._id }
      });

      socket.emit('room:created', {
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
          createdAt: room.createdAt
        }
      });

    } catch (error) {
      console.error('Create room error:', error);
      socket.emit('error', { message: 'Failed to create room' });
    }
  });

  /**
   * Invite user to room
   */
  socket.on('room:invite', async (data) => {
    try {
      const { roomId, userIdToInvite } = data;

      if (!roomId || !userIdToInvite) {
        socket.emit('error', { message: 'Room ID and user ID are required' });
        return;
      }

      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if current user can invite (member with invite permissions or admin)
      if (!room.isMember(userId) || (!room.settings.allowInvites && !room.isAdmin(userId))) {
        socket.emit('error', { message: 'You do not have permission to invite users' });
        return;
      }

      // Check if user to invite exists
      const userToInvite = await User.findById(userIdToInvite);
      if (!userToInvite || !userToInvite.isActive) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Check if user is already a member
      if (room.isMember(userIdToInvite)) {
        socket.emit('error', { message: 'User is already a member' });
        return;
      }

      // Add user to room
      await room.addMember(userIdToInvite);
      await room.populate('members.user', 'username avatar status');

      // Add room to user's joined rooms
      await User.findByIdAndUpdate(userIdToInvite, {
        $addToSet: { joinedRooms: room._id }
      });

      // Notify all room members about new member
      io.to(roomId).emit('room:member_added', {
        roomId,
        newMember: {
          user: {
            _id: userToInvite._id,
            username: userToInvite.username,
            avatar: userToInvite.avatar,
            status: userToInvite.status
          },
          role: 'member',
          joinedAt: new Date()
        },
        invitedBy: {
          _id: userId,
          username: user.username
        }
      });

      // Send invitation notification to the invited user
      sendToUser(io, userIdToInvite, 'room:invitation', {
        room: {
          _id: room._id,
          name: room.name,
          type: room.type,
          avatar: room.avatar
        },
        invitedBy: {
          _id: userId,
          username: user.username,
          avatar: user.avatar
        }
      });

      socket.emit('room:invite:success', {
        roomId,
        invitedUser: userToInvite.username
      });

    } catch (error) {
      console.error('Invite user error:', error);
      socket.emit('error', { message: 'Failed to invite user' });
    }
  });

  /**
   * Remove user from room
   */
  socket.on('room:remove_member', async (data) => {
    try {
      const { roomId, userIdToRemove } = data;

      if (!roomId || !userIdToRemove) {
        socket.emit('error', { message: 'Room ID and user ID are required' });
        return;
      }

      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if current user is admin
      if (!room.isAdmin(userId)) {
        socket.emit('error', { message: 'Admin privileges required' });
        return;
      }

      // Cannot remove room creator
      if (room.creator.toString() === userIdToRemove) {
        socket.emit('error', { message: 'Cannot remove room creator' });
        return;
      }

      // Check if user is a member
      if (!room.isMember(userIdToRemove)) {
        socket.emit('error', { message: 'User is not a member of this room' });
        return;
      }

      // Remove user from room
      await room.removeMember(userIdToRemove);

      // Remove room from user's joined rooms
      await User.findByIdAndUpdate(userIdToRemove, {
        $pull: { joinedRooms: room._id }
      });

      // Get removed user info
      const removedUser = await User.findById(userIdToRemove);

      // Notify all room members about removed member
      io.to(roomId).emit('room:member_removed', {
        roomId,
        removedMember: {
          _id: userIdToRemove,
          username: removedUser.username
        },
        removedBy: {
          _id: userId,
          username: user.username
        }
      });

      // Notify the removed user
      sendToUser(io, userIdToRemove, 'room:removed', {
        roomId,
        roomName: room.name,
        removedBy: {
          _id: userId,
          username: user.username
        }
      });

      socket.emit('room:remove_member:success', {
        roomId,
        removedUser: removedUser.username
      });

    } catch (error) {
      console.error('Remove member error:', error);
      socket.emit('error', { message: 'Failed to remove member' });
    }
  });

  /**
   * Update member role
   */
  socket.on('room:update_role', async (data) => {
    try {
      const { roomId, userIdToUpdate, newRole } = data;

      if (!roomId || !userIdToUpdate || !newRole) {
        socket.emit('error', { message: 'Room ID, user ID, and role are required' });
        return;
      }

      if (!['admin', 'moderator', 'member'].includes(newRole)) {
        socket.emit('error', { message: 'Invalid role' });
        return;
      }

      const room = await Room.findById(roomId);
      if (!room) {
        socket.emit('error', { message: 'Room not found' });
        return;
      }

      // Check if current user is admin
      if (!room.isAdmin(userId)) {
        socket.emit('error', { message: 'Admin privileges required' });
        return;
      }

      // Cannot change creator's role
      if (room.creator.toString() === userIdToUpdate) {
        socket.emit('error', { message: 'Cannot change creator role' });
        return;
      }

      // Update member role
      await room.updateMemberRole(userIdToUpdate, newRole);

      // Get updated user info
      const updatedUser = await User.findById(userIdToUpdate);

      // Notify all room members about role update
      io.to(roomId).emit('room:role_updated', {
        roomId,
        member: {
          _id: userIdToUpdate,
          username: updatedUser.username,
          newRole
        },
        updatedBy: {
          _id: userId,
          username: user.username
        }
      });

      socket.emit('room:update_role:success', {
        roomId,
        updatedUser: updatedUser.username,
        newRole
      });

    } catch (error) {
      console.error('Update role error:', error);
      socket.emit('error', { message: 'Failed to update role' });
    }
  });

  /**
   * Get room list for user
   */
  socket.on('rooms:list', async () => {
    try {
      const rooms = await Room.findUserRooms(userId);

      socket.emit('rooms:list', {
        rooms: rooms.map(room => ({
          _id: room._id,
          name: room.name,
          description: room.description,
          type: room.type,
          avatar: room.avatar,
          creator: room.creator,
          memberCount: room.memberCount,
          lastActivity: room.lastActivity,
          lastMessage: room.lastMessage,
          unreadCount: 0, // This would be calculated based on user's last read
          createdAt: room.createdAt
        }))
      });

    } catch (error) {
      console.error('Get rooms error:', error);
      socket.emit('error', { message: 'Failed to get rooms' });
    }
  });

  /**
   * Create direct message room
   */
  socket.on('room:create_direct', async (data) => {
    try {
      const { userIdToChat } = data;

      if (!userIdToChat) {
        socket.emit('error', { message: 'User ID is required' });
        return;
      }

      if (userIdToChat === userId) {
        socket.emit('error', { message: 'Cannot create direct message with yourself' });
        return;
      }

      // Check if target user exists
      const targetUser = await User.findById(userIdToChat);
      if (!targetUser || !targetUser.isActive) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Create or get existing direct room
      const room = await Room.createDirectRoom(userId, userIdToChat);
      await room.populate('members.user', 'username avatar status');

      // Join socket room
      socket.join(room._id.toString());

      // Notify target user about direct message room
      sendToUser(io, userIdToChat, 'room:direct_created', {
        room: {
          _id: room._id,
          name: user.username, // For direct messages, show other user's name
          type: room.type,
          members: room.members,
          createdAt: room.createdAt
        },
        otherUser: {
          _id: userId,
          username: user.username,
          avatar: user.avatar,
          status: user.status
        }
      });

      socket.emit('room:direct_created', {
        room: {
          _id: room._id,
          name: targetUser.username, // For direct messages, show other user's name
          type: room.type,
          members: room.members,
          createdAt: room.createdAt
        },
        otherUser: {
          _id: targetUser._id,
          username: targetUser.username,
          avatar: targetUser.avatar,
          status: targetUser.status
        }
      });

    } catch (error) {
      console.error('Create direct room error:', error);
      socket.emit('error', { message: 'Failed to create direct message' });
    }
  });
};

module.exports = roomHandlers;

