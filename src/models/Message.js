const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  content: {
    type: String,
    required: [true, 'Message content is required'],
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true
  },
  type: {
    type: String,
    enum: ['text', 'image', 'file', 'system'],
    default: 'text'
  },
  metadata: {
    // For file/image messages
    fileName: String,
    fileSize: Number,
    mimeType: String,
    fileUrl: String,
    
    // For system messages
    systemType: {
      type: String,
      enum: ['user_joined', 'user_left', 'room_created', 'user_promoted', 'user_demoted']
    },
    
    // For replies
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message'
    },
    
    // For edited messages
    editedAt: Date,
    editHistory: [{
      content: String,
      editedAt: {
        type: Date,
        default: Date.now
      }
    }]
  },
  reactions: [{
    emoji: {
      type: String,
      required: true
    },
    users: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }],
    count: {
      type: Number,
      default: 0
    }
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
messageSchema.index({ room: 1, createdAt: -1 });
messageSchema.index({ sender: 1 });
messageSchema.index({ createdAt: -1 });
messageSchema.index({ 'readBy.user': 1 });
messageSchema.index({ isDeleted: 1 });

// Virtual for reaction summary
messageSchema.virtual('reactionSummary').get(function() {
  return this.reactions.map(reaction => ({
    emoji: reaction.emoji,
    count: reaction.count,
    users: reaction.users
  }));
});

// Virtual for read status
messageSchema.virtual('isRead').get(function() {
  return this.readBy.length > 0;
});

// Pre-save middleware
messageSchema.pre('save', function(next) {
  // Update reaction counts
  this.reactions.forEach(reaction => {
    reaction.count = reaction.users.length;
  });
  next();
});

// Instance method to add reaction
messageSchema.methods.addReaction = function(emoji, userId) {
  let reaction = this.reactions.find(r => r.emoji === emoji);
  
  if (!reaction) {
    reaction = { emoji, users: [], count: 0 };
    this.reactions.push(reaction);
  }
  
  // Check if user already reacted with this emoji
  if (!reaction.users.includes(userId)) {
    reaction.users.push(userId);
    reaction.count = reaction.users.length;
  }
  
  return this.save();
};

// Instance method to remove reaction
messageSchema.methods.removeReaction = function(emoji, userId) {
  const reaction = this.reactions.find(r => r.emoji === emoji);
  
  if (reaction) {
    reaction.users = reaction.users.filter(
      user => user.toString() !== userId.toString()
    );
    reaction.count = reaction.users.length;
    
    // Remove reaction if no users left
    if (reaction.count === 0) {
      this.reactions = this.reactions.filter(r => r.emoji !== emoji);
    }
  }
  
  return this.save();
};

// Instance method to mark as read
messageSchema.methods.markAsRead = function(userId) {
  // Check if already marked as read by this user
  const existingRead = this.readBy.find(
    read => read.user.toString() === userId.toString()
  );
  
  if (!existingRead) {
    this.readBy.push({
      user: userId,
      readAt: new Date()
    });
    return this.save();
  }
  
  return Promise.resolve(this);
};

// Instance method to edit message
messageSchema.methods.editContent = function(newContent, editorId) {
  // Only sender can edit their own messages
  if (this.sender.toString() !== editorId.toString()) {
    throw new Error('Only the sender can edit this message');
  }
  
  // Add to edit history
  if (!this.metadata.editHistory) {
    this.metadata.editHistory = [];
  }
  
  this.metadata.editHistory.push({
    content: this.content,
    editedAt: new Date()
  });
  
  this.content = newContent;
  this.metadata.editedAt = new Date();
  
  return this.save();
};

// Instance method to soft delete
messageSchema.methods.softDelete = function(deleterId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deleterId;
  this.content = 'This message has been deleted';
  
  return this.save();
};

// Static method to get room messages with pagination
messageSchema.statics.getRoomMessages = function(roomId, page = 1, limit = 50) {
  const skip = (page - 1) * limit;
  
  return this.find({
    room: roomId,
    isDeleted: false
  })
  .populate('sender', 'username avatar status')
  .populate('metadata.replyTo', 'content sender')
  .populate('readBy.user', 'username')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
};

// Static method to get unread message count
messageSchema.statics.getUnreadCount = function(roomId, userId, lastReadAt) {
  return this.countDocuments({
    room: roomId,
    sender: { $ne: userId },
    createdAt: { $gt: lastReadAt },
    isDeleted: false
  });
};

// Static method to search messages
messageSchema.statics.searchMessages = function(roomId, query, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const searchRegex = new RegExp(query, 'i');
  
  return this.find({
    room: roomId,
    content: searchRegex,
    isDeleted: false
  })
  .populate('sender', 'username avatar')
  .sort({ createdAt: -1 })
  .skip(skip)
  .limit(limit);
};

// Static method to get message statistics
messageSchema.statics.getMessageStats = function(roomId, startDate, endDate) {
  const matchStage = {
    room: mongoose.Types.ObjectId(roomId),
    isDeleted: false
  };
  
  if (startDate && endDate) {
    matchStage.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$sender',
        messageCount: { $sum: 1 },
        lastMessage: { $max: '$createdAt' }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $unwind: '$user'
    },
    {
      $project: {
        username: '$user.username',
        avatar: '$user.avatar',
        messageCount: 1,
        lastMessage: 1
      }
    },
    { $sort: { messageCount: -1 } }
  ]);
};

module.exports = mongoose.model('Message', messageSchema);

