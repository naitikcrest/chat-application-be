const { io } = require('socket.io-client');

// Test script to verify Socket.IO server functionality
async function testServer() {
  console.log('🧪 Testing Socket.IO server...');
  
  const socket = io('http://localhost:5000');
  
  socket.on('connect', () => {
    console.log('✅ Connected to server');
    
    // Test joining a room
    socket.emit('join', { username: 'TestUser', room: 'general' });
    
    // Test sending a message
    setTimeout(() => {
      socket.emit('send_message', { message: 'Hello from test script!' });
    }, 1000);
    
    // Test getting rooms
    setTimeout(() => {
      socket.emit('get_rooms');
    }, 2000);
    
    // Disconnect after tests
    setTimeout(() => {
      socket.disconnect();
      console.log('🔌 Disconnected from server');
      process.exit(0);
    }, 3000);
  });
  
  socket.on('new_message', (message) => {
    console.log('📨 Received message:', message);
  });
  
  socket.on('rooms_list', (rooms) => {
    console.log('🏠 Available rooms:', rooms);
  });
  
  socket.on('error', (error) => {
    console.error('❌ Socket error:', error);
  });
  
  socket.on('connect_error', (error) => {
    console.error('❌ Connection error:', error);
    process.exit(1);
  });
}

// Run test if server is running
testServer();

