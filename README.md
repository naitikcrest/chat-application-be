# Chat Application Backend

A modern Socket.IO server built with Node.js v22 for real-time chat functionality.

## Features

- ✅ Real-time messaging with Socket.IO
- ✅ Multiple chat rooms support
- ✅ User presence tracking
- ✅ Typing indicators
- ✅ Message history
- ✅ JSON file-based storage (no database required)
- ✅ CORS enabled for frontend integration
- ✅ RESTful API endpoints
- ✅ Latest Node.js v22 compatibility
- ✅ No deprecated packages

## Tech Stack

- **Node.js**: v22.14.0 (Latest LTS)
- **Socket.IO**: v4.8.1 (Latest)
- **Express**: v4.21.2 (Latest)
- **CORS**: v2.8.5
- **dotenv**: v16.4.7

## Installation

1. Clone the repository:
```bash
git clone https://github.com/naitikcrest/chat-application-be.git
cd chat-application-be
```

2. Install dependencies:
```bash
npm install
```

3. Copy environment configuration:
```bash
cp .env.example .env
```

4. Update `.env` file with your configuration:
```env
PORT=5000
CLIENT_URL=http://localhost:3000
NODE_ENV=development
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm start
```

The server will start on `http://localhost:5000` (or your configured PORT).

## Socket.IO Events

### Client to Server Events

| Event | Data | Description |
|-------|------|-------------|
| `join` | `{ username, room }` | Join a chat room |
| `send_message` | `{ message }` | Send a message to current room |
| `get_messages` | `{ room, limit }` | Get message history |
| `get_rooms` | - | Get available rooms |
| `switch_room` | `{ room }` | Switch to different room |
| `typing` | `{ isTyping }` | Send typing indicator |

### Server to Client Events

| Event | Data | Description |
|-------|------|-------------|
| `new_message` | `{ id, username, message, room, timestamp, type }` | New message received |
| `user_joined` | `{ username, message, timestamp }` | User joined room |
| `user_left` | `{ username, message, timestamp }` | User left room |
| `room_users` | `[{ id, username, room, joinedAt }]` | Current room users |
| `message_history` | `[messages]` | Historical messages |
| `rooms_list` | `[{ id, name, description }]` | Available rooms |
| `room_switched` | `{ room }` | Room switch confirmation |
| `user_typing` | `{ username, isTyping }` | Typing indicator |
| `error` | `{ message }` | Error message |

## REST API Endpoints

### Health Check
```
GET /api/health
```
Returns server status and connected users count.

### Statistics
```
GET /api/stats
```
Returns server statistics including total messages, users, and rooms.

## Data Storage

The application uses JSON files for data persistence:

- `data/messages.json` - Chat messages (last 1000 messages)
- `data/users.json` - User information and status
- `data/rooms.json` - Available chat rooms

### Default Room
- **General**: Default chat room for all users

## Example Client Usage

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:5000');

// Join a room
socket.emit('join', { username: 'John', room: 'general' });

// Send a message
socket.emit('send_message', { message: 'Hello everyone!' });

// Listen for new messages
socket.on('new_message', (message) => {
  console.log('New message:', message);
});

// Get message history
socket.emit('get_messages', { room: 'general', limit: 50 });
socket.on('message_history', (messages) => {
  console.log('Message history:', messages);
});
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5000` | Server port |
| `CLIENT_URL` | `http://localhost:3000` | Frontend URL for CORS |
| `NODE_ENV` | `development` | Environment mode |

## Error Handling

The server includes comprehensive error handling:
- Graceful Socket.IO disconnections
- File system error handling
- Uncaught exception handling
- Validation for user inputs

## Development

### File Structure
```
├── server.js          # Main server file
├── package.json       # Dependencies and scripts
├── .env.example       # Environment template
├── .gitignore         # Git ignore rules
├── README.md          # Documentation
└── data/              # JSON storage (auto-created)
    ├── messages.json  # Chat messages
    ├── users.json     # User data
    └── rooms.json     # Room configuration
```

### Scripts
- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

ISC License

