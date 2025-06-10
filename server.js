const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const app = express();
const server = createServer(app);

// Configure CORS for Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true
}));
app.use(express.json());

// Data storage paths
const DATA_DIR = path.join(__dirname, 'data');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// Initialize data storage
async function initializeDataStorage() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    
    // Initialize messages file
    try {
      await fs.access(MESSAGES_FILE);
    } catch {
      await fs.writeFile(MESSAGES_FILE, JSON.stringify([], null, 2));
    }
    
    // Initialize users file
    try {
      await fs.access(USERS_FILE);
    } catch {
      await fs.writeFile(USERS_FILE, JSON.stringify([], null, 2));
    }
    
    // Initialize rooms file
    try {
      await fs.access(ROOMS_FILE);
    } catch {
      await fs.writeFile(ROOMS_FILE, JSON.stringify([
        { id: 'general', name: 'General', description: 'General chat room' }
      ], null, 2));
    }
    
    console.log('✅ Data storage initialized');
  } catch (error) {
    console.error('❌ Error initializing data storage:', error);
  }
}

// Data helper functions
async function readJsonFile(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return [];
  }
}

async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
}

// Store connected users
const connectedUsers = new Map();

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`🔗 User connected: ${socket.id}`);

  // Handle user joining
  socket.on('join', async (userData) => {
    try {
      const { username, room = 'general' } = userData;
      
      // Store user info
      connectedUsers.set(socket.id, {
        id: socket.id,
        username,
        room,
        joinedAt: new Date().toISOString()
      });
      
      // Join the room
      socket.join(room);
      
      // Save user to file
      const users = await readJsonFile(USERS_FILE);
      const existingUserIndex = users.findIndex(u => u.username === username);
      
      if (existingUserIndex >= 0) {
        users[existingUserIndex] = {
          ...users[existingUserIndex],
          lastSeen: new Date().toISOString(),
          isOnline: true
        };
      } else {
        users.push({
          id: socket.id,
          username,
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
          isOnline: true
        });
      }
      
      await writeJsonFile(USERS_FILE, users);
      
      // Notify room about new user
      socket.to(room).emit('user_joined', {
        username,
        message: `${username} joined the chat`,
        timestamp: new Date().toISOString()
      });
      
      // Send current room users to the new user
      const roomUsers = Array.from(connectedUsers.values())
        .filter(user => user.room === room);
      
      socket.emit('room_users', roomUsers);
      
      console.log(`👤 ${username} joined room: ${room}`);
    } catch (error) {
      console.error('Error handling join:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // Handle sending messages
  socket.on('send_message', async (messageData) => {
    try {
      const user = connectedUsers.get(socket.id);
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      const message = {
        id: Date.now().toString(),
        username: user.username,
        message: messageData.message,
        room: user.room,
        timestamp: new Date().toISOString(),
        type: 'message'
      };

      // Save message to file
      const messages = await readJsonFile(MESSAGES_FILE);
      messages.push(message);
      
      // Keep only last 1000 messages to prevent file from growing too large
      if (messages.length > 1000) {
        messages.splice(0, messages.length - 1000);
      }
      
      await writeJsonFile(MESSAGES_FILE, messages);

      // Broadcast message to room
      io.to(user.room).emit('new_message', message);
      
      console.log(`💬 Message from ${user.username} in ${user.room}: ${messageData.message}`);
    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Handle getting message history
  socket.on('get_messages', async (data) => {
    try {
      const { room = 'general', limit = 50 } = data;
      const messages = await readJsonFile(MESSAGES_FILE);
      
      const roomMessages = messages
        .filter(msg => msg.room === room)
        .slice(-limit);
      
      socket.emit('message_history', roomMessages);
    } catch (error) {
      console.error('Error getting messages:', error);
      socket.emit('error', { message: 'Failed to get messages' });
    }
  });

  // Handle getting available rooms
  socket.on('get_rooms', async () => {
    try {
      const rooms = await readJsonFile(ROOMS_FILE);
      socket.emit('rooms_list', rooms);
    } catch (error) {
      console.error('Error getting rooms:', error);
      socket.emit('error', { message: 'Failed to get rooms' });
    }
  });

  // Handle room switching
  socket.on('switch_room', async (data) => {
    try {
      const { room } = data;
      const user = connectedUsers.get(socket.id);
      
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        return;
      }

      // Leave current room
      socket.leave(user.room);
      
      // Update user's room
      user.room = room;
      connectedUsers.set(socket.id, user);
      
      // Join new room
      socket.join(room);
      
      // Notify about room switch
      socket.emit('room_switched', { room });
      
      // Get room users
      const roomUsers = Array.from(connectedUsers.values())
        .filter(u => u.room === room);
      
      socket.emit('room_users', roomUsers);
      
      console.log(`🔄 ${user.username} switched to room: ${room}`);
    } catch (error) {
      console.error('Error switching room:', error);
      socket.emit('error', { message: 'Failed to switch room' });
    }
  });

  // Handle typing indicators
  socket.on('typing', (data) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      socket.to(user.room).emit('user_typing', {
        username: user.username,
        isTyping: data.isTyping
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    try {
      const user = connectedUsers.get(socket.id);
      
      if (user) {
        // Update user status in file
        const users = await readJsonFile(USERS_FILE);
        const userIndex = users.findIndex(u => u.username === user.username);
        
        if (userIndex >= 0) {
          users[userIndex].isOnline = false;
          users[userIndex].lastSeen = new Date().toISOString();
          await writeJsonFile(USERS_FILE, users);
        }
        
        // Notify room about user leaving
        socket.to(user.room).emit('user_left', {
          username: user.username,
          message: `${user.username} left the chat`,
          timestamp: new Date().toISOString()
        });
        
        // Remove from connected users
        connectedUsers.delete(socket.id);
        
        console.log(`👋 ${user.username} disconnected`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  });
});

// REST API endpoints
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    connectedUsers: connectedUsers.size
  });
});

app.get('/api/stats', async (req, res) => {
  try {
    const messages = await readJsonFile(MESSAGES_FILE);
    const users = await readJsonFile(USERS_FILE);
    const rooms = await readJsonFile(ROOMS_FILE);
    
    res.json({
      totalMessages: messages.length,
      totalUsers: users.length,
      connectedUsers: connectedUsers.size,
      totalRooms: rooms.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  await initializeDataStorage();
  
  server.listen(PORT, () => {
    console.log(`🚀 Socket.IO server running on port ${PORT}`);
    console.log(`🌐 CORS enabled for: ${process.env.CLIENT_URL || "http://localhost:3000"}`);
    console.log(`📁 Data stored in: ${DATA_DIR}`);
  });
}

startServer().catch(console.error);

