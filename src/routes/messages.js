const express = require('express');
const { body } = require('express-validator');
const {
  getRoomMessages,
  searchMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
  addReaction,
  removeReaction,
  markAsRead,
  getUnreadCount
} = require('../controllers/messageController');
const { authenticate, authorizeRoomMember } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Validation rules
const updateMessageValidation = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message content must be between 1 and 2000 characters')
];

const reactionValidation = [
  body('emoji')
    .notEmpty()
    .withMessage('Emoji is required')
    .isLength({ min: 1, max: 10 })
    .withMessage('Emoji must be between 1 and 10 characters')
];

const markReadValidation = [
  body('messageIds')
    .optional()
    .isArray()
    .withMessage('Message IDs must be an array')
];

// Routes

/**
 * GET /api/messages/room/:roomId
 * Get messages for a room with pagination
 * Query params: page, limit
 */
router.get('/room/:roomId', getRoomMessages);

/**
 * GET /api/messages/room/:roomId/search
 * Search messages in a room
 * Query params: q (query), page, limit
 */
router.get('/room/:roomId/search', searchMessages);

/**
 * GET /api/messages/room/:roomId/unread-count
 * Get unread message count for a room
 */
router.get('/room/:roomId/unread-count', getUnreadCount);

/**
 * POST /api/messages/room/:roomId/mark-read
 * Mark messages as read in a room
 */
router.post('/room/:roomId/mark-read', markReadValidation, markAsRead);

/**
 * GET /api/messages/:messageId
 * Get a specific message by ID
 */
router.get('/:messageId', getMessageById);

/**
 * PUT /api/messages/:messageId
 * Update (edit) a message
 */
router.put('/:messageId', updateMessageValidation, updateMessage);

/**
 * DELETE /api/messages/:messageId
 * Delete a message
 */
router.delete('/:messageId', deleteMessage);

/**
 * POST /api/messages/:messageId/reactions
 * Add reaction to a message
 */
router.post('/:messageId/reactions', reactionValidation, addReaction);

/**
 * DELETE /api/messages/:messageId/reactions
 * Remove reaction from a message
 */
router.delete('/:messageId/reactions', reactionValidation, removeReaction);

module.exports = router;

