const express = require('express');
const { body } = require('express-validator');
const {
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
} = require('../controllers/userController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Validation rules
const addFriendValidation = [
  body('userIdToAdd')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

const removeFriendValidation = [
  body('userIdToRemove')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

const blockUserValidation = [
  body('userIdToBlock')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

const unblockUserValidation = [
  body('userIdToUnblock')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

const updateStatusValidation = [
  body('status')
    .isIn(['online', 'away', 'busy', 'offline'])
    .withMessage('Status must be online, away, busy, or offline')
];

// Routes

/**
 * GET /api/users/search
 * Search users
 * Query params: q (query), limit
 */
router.get('/search', searchUsers);

/**
 * GET /api/users/online
 * Get online users
 * Query params: limit
 */
router.get('/online', getOnlineUsers);

/**
 * GET /api/users/friends
 * Get user's friends
 */
router.get('/friends', getFriends);

/**
 * POST /api/users/friends
 * Add friend
 */
router.post('/friends', addFriendValidation, addFriend);

/**
 * DELETE /api/users/friends
 * Remove friend
 */
router.delete('/friends', removeFriendValidation, removeFriend);

/**
 * GET /api/users/blocked
 * Get blocked users
 */
router.get('/blocked', getBlockedUsers);

/**
 * POST /api/users/block
 * Block user
 */
router.post('/block', blockUserValidation, blockUser);

/**
 * POST /api/users/unblock
 * Unblock user
 */
router.post('/unblock', unblockUserValidation, unblockUser);

/**
 * PUT /api/users/status
 * Update user status
 */
router.put('/status', updateStatusValidation, updateStatus);

/**
 * GET /api/users/:userId
 * Get user by ID
 */
router.get('/:userId', getUserById);

module.exports = router;

