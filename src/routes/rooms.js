const express = require('express');
const { body } = require('express-validator');
const {
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
} = require('../controllers/roomController');
const { authenticate, authorizeRoomMember, authorizeRoomAdmin } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Validation rules
const createRoomValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Room name must be between 1 and 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description cannot exceed 200 characters'),
  body('type')
    .optional()
    .isIn(['group', 'public'])
    .withMessage('Type must be either group or public'),
  body('isPrivate')
    .optional()
    .isBoolean()
    .withMessage('isPrivate must be a boolean'),
  body('maxMembers')
    .optional()
    .isInt({ min: 2, max: 1000 })
    .withMessage('maxMembers must be between 2 and 1000')
];

const updateRoomValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Room name must be between 1 and 50 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Description cannot exceed 200 characters'),
  body('avatar')
    .optional()
    .isURL()
    .withMessage('Avatar must be a valid URL'),
  body('settings.isPrivate')
    .optional()
    .isBoolean()
    .withMessage('isPrivate must be a boolean'),
  body('settings.allowInvites')
    .optional()
    .isBoolean()
    .withMessage('allowInvites must be a boolean'),
  body('settings.maxMembers')
    .optional()
    .isInt({ min: 2, max: 1000 })
    .withMessage('maxMembers must be between 2 and 1000')
];

const addMemberValidation = [
  body('userIdToAdd')
    .isMongoId()
    .withMessage('Valid user ID is required'),
  body('role')
    .optional()
    .isIn(['admin', 'moderator', 'member'])
    .withMessage('Role must be admin, moderator, or member')
];

const removeMemberValidation = [
  body('userIdToRemove')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

const updateRoleValidation = [
  body('userIdToUpdate')
    .isMongoId()
    .withMessage('Valid user ID is required'),
  body('newRole')
    .isIn(['admin', 'moderator', 'member'])
    .withMessage('Role must be admin, moderator, or member')
];

const createDirectRoomValidation = [
  body('userIdToChat')
    .isMongoId()
    .withMessage('Valid user ID is required')
];

// Routes

/**
 * GET /api/rooms
 * Get user's rooms
 * Query params: page, limit
 */
router.get('/', getUserRooms);

/**
 * GET /api/rooms/public
 * Get public rooms
 * Query params: page, limit
 */
router.get('/public', getPublicRooms);

/**
 * POST /api/rooms
 * Create a new room
 */
router.post('/', createRoomValidation, createRoom);

/**
 * POST /api/rooms/direct
 * Create a direct message room
 */
router.post('/direct', createDirectRoomValidation, createDirectRoom);

/**
 * GET /api/rooms/:roomId
 * Get room by ID
 */
router.get('/:roomId', getRoomById);

/**
 * PUT /api/rooms/:roomId
 * Update room (admin only)
 */
router.put('/:roomId', updateRoomValidation, updateRoom);

/**
 * DELETE /api/rooms/:roomId
 * Delete room (creator only)
 */
router.delete('/:roomId', deleteRoom);

/**
 * POST /api/rooms/:roomId/join
 * Join a room
 */
router.post('/:roomId/join', joinRoom);

/**
 * POST /api/rooms/:roomId/leave
 * Leave a room
 */
router.post('/:roomId/leave', leaveRoom);

/**
 * POST /api/rooms/:roomId/members
 * Add member to room
 */
router.post('/:roomId/members', addMemberValidation, addMember);

/**
 * DELETE /api/rooms/:roomId/members
 * Remove member from room (admin only)
 */
router.delete('/:roomId/members', removeMemberValidation, removeMember);

/**
 * PUT /api/rooms/:roomId/members/role
 * Update member role (admin only)
 */
router.put('/:roomId/members/role', updateRoleValidation, updateMemberRole);

module.exports = router;

