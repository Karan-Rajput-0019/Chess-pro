# Chess Pro - Multiplayer Chess Game

A full-featured multiplayer chess application with ELO ratings, chat, timers, and more!

## Features

- Real-time multiplayer gameplay
- ELO rating system
- In-game chat
- Multiple time controls (Bullet, Blitz, Rapid)
- User authentication
- Game history
- Multiple board themes
- Responsive design

## Setup Instructions

### 1. Copy Code Files

Copy the following code from the markdown files:

- backend/server.js from vscode-setup-pt2.md [100]
- frontend/index.html from frontend-html-file.md [101]
- frontend/style.css from frontend-css-file.md [102]
- frontend/game.js from frontend-js-complete.md [104]

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Start MongoDB

Make sure MongoDB is running on your system:

```bash
mongod
```

Or use MongoDB Atlas cloud database.

### 4. Configure Environment

Update backend/.env with your settings:

```
PORT=3000
MONGODB_URI=mongodb://localhost:27017/chess-pro
JWT_SECRET=your-secret-key-here
```

### 5. Start the Server

```bash
cd backend
npm run dev
```

### 6. Open in Browser

Navigate to: http://localhost:3000

## Technology Stack

**Backend:**
- Node.js
- Express.js
- Socket.io
- MongoDB
- Chess.js

**Frontend:**
- HTML5
- CSS3
- Vanilla JavaScript
- Socket.io Client

## License

MIT
