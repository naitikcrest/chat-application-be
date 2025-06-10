const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Room name is required'],
    trim: true,
    minlength: [1, 'Room name must be at least 1 character long'],
    maxlength: [50, 'Room name cannot exceed 50 characters']
  },
  description: {
    type: String,
    maxlength: [200, 'Description cannot exceed 200 characters'],
    default: ''
  },
  type: {
    type: String,
    enum: ['direct', 'group', 'public'],
    required: true,
    default: 'group'
  },
  avatar: {
    type: String,
    default: null
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['admin', 'moderator', 'member'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    },
    lastReadAt: {
      type: Date,
      default: Date.now
    }
  }],
  settings: {
    isPrivate: {
      type: Boolean,
      default: false
    },
    allowInvites: {
      type: Boolean,
      default: true
    },
    maxMembers: {
      type: Number,
      default: 100,
      min: 2,
      max: 1000
    }
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
roomSchema.index({ type: 1 });
roomSchema.index({ 'members.user': 1 });
roomSchema.index({ creator: 1 });
roomSchema.index({ lastActivity: -1 });
roomSchema.index({ 'settings.isPrivate': 1 });

// Compound index for direct messages (to prevent duplicates)
roomSchema.index({ 
  type: 1, 
  'members.user': 1 
}, { 
  unique: true, 
  partialFilterExpression: { type: 'direct' }
});

// Virtual for member count
roomSchema.virtual('memberCount').get(function() {
  return this.members.length;
});

// Virtual for active members
roomSchema.virtual('activeMembers').get(function() {
  return this.members.filter(member => member.user.isActive !== false);
});

// Pre-save middleware
roomSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});

// Instance method to add member
roomSchema.methods.addMember = function(userId, role = 'member') {
  // Check if user is already a member
  const existingMember = this.members.find(
    member => member.user.toString() === userId.toString()
  );
  
  if (existingMember) {
    throw new Error('User is already a member of this room');
  }
  
  // Check member limit
  if (this.members.length >= this.settings.maxMembers) {
    throw new Error('Room has reached maximum member limit');
  }
  
  this.members.push({
    user: userId,
    role: role,
    joinedAt: new Date(),
    lastReadAt: new Date()
  });
  
  return this.save();
};

// Instance method to remove member
roomSchema.methods.removeMember = function(userId) {
  this.members = this.members.filter(
    member => member.user.toString() !== userId.toString()
  );
  return this.save();
};

// Instance method to update member role
roomSchema.methods.updateMemberRole = function(userId, newRole) {
  const member = this.members.find(
    member => member.user.toString() === userId.toString()
  );
  
  if (!member) {
    throw new Error('User is not a member of this room');
  }
  
  member.role = newRole;
  return this.save();
};

// Instance method to update last read
roomSchema.methods.updateLastRead = function(userId) {
  const member = this.members.find(
    member => member.user.toString() === userId.toString()
  );
  
  if (member) {
    member.lastReadAt = new Date();
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to check if user is member
roomSchema.methods.isMember = function(userId) {
  return this.members.some(
    member => member.user.toString() === userId.toString()
  );
};

// Instance method to check if user is admin
roomSchema.methods.isAdmin = function(userId) {
  const member = this.members.find(
    member => member.user.toString() === userId.toString()
  );
  return member && (member.role === 'admin' || this.creator.toString() === userId.toString());
};

// Static method to find user's rooms
roomSchema.statics.findUserRooms = function(userId) {
  return this.find({
    'members.user': userId,
    isActive: true
  })
  .populate('members.user', 'username avatar status')
  .populate('lastMessage')
  .populate('creator', 'username avatar')
  .sort({ lastActivity: -1 });
};

// Static method to create direct message room
roomSchema.statics.createDirectRoom = async function(user1Id, user2Id) {
  // Check if direct room already exists
  const existingRoom = await this.findOne({
    type: 'direct',
    'members.user': { $all: [user1Id, user2Id] }
  });
  
  if (existingRoom) {
    return existingRoom;
  }
  
  // Create new direct room
  const room = new this({
    name: 'Direct Message',
    type: 'direct',
    creator: user1Id,
    members: [
      { user: user1Id, role: 'admin' },
      { user: user2Id, role: 'admin' }
    ],
    settings: {
      isPrivate: true,
      allowInvites: false,
      maxMembers: 2
    }
  });
  
  return room.save();
};

// Static method to find public rooms
roomSchema.statics.findPublicRooms = function(page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  
  return this.find({
    type: 'public',
    'settings.isPrivate': false,
    isActive: true
  })
  .populate('creator', 'username avatar')
  .populate('lastMessage')
  .sort({ memberCount: -1, lastActivity: -1 })
  .skip(skip)
  .limit(limit);
};

module.exports = mongoose.model('Room', roomSchema);

