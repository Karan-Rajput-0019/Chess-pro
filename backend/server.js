const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const cors = require('cors');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const { updateRatings } = require('./utils/eloCalculator');
const User = require('./models/User');
const Game = require('./models/Game');
const Tournament = require('./models/Tournament');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chess-pro', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ MongoDB connected successfully');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// Game state management
const games = new Map();
const waitingPlayers = [];
const activeSockets = new Map();

// Timer configuration
const TIME_CONTROLS = {
  bullet: { initial: 60000, increment: 0 },           // 1+0
  blitz: { initial: 300000, increment: 0 },           // 5+0
  rapid: { initial: 600000, increment: 0 },           // 10+0
  blitz_increment: { initial: 180000, increment: 2000 } // 3+2
};

// Enhanced Game room class with all features
class GameRoom {
  constructor(roomId, player1Socket, timeControl = 'blitz', player1Info, mode = 'pvp') {
    this.roomId = roomId;
    this.game = new Chess();
    this.mode = mode; // 'pvp' or 'ai'
    this.players = {
      white: player1Socket.id,
      black: null
    };
    this.sockets = {
      [player1Socket.id]: player1Socket
    };
    this.spectators = new Set();
    this.chatMessages = [];
    // Timer configuration
    this.timeControl = TIME_CONTROLS[timeControl] || TIME_CONTROLS.blitz;
    this.timers = {
      white: this.timeControl.initial,
      black: this.timeControl.initial
    };
    this.currentTurnStartTime = null;
    this.timerInterval = null;
    // Player info
    this.playerInfo = {
      white: player1Info || { username: 'Player 1', rating: 1200, id: null },
      black: { username: 'Player 2', rating: 1200, id: null }
    };
    this.gameStarted = false;
  }

  addPlayer(playerSocket, playerInfo) {
    if (!this.players.black) {
      this.players.black = playerSocket.id;
      this.sockets[playerSocket.id] = playerSocket;
      this.playerInfo.black = playerInfo;
      return 'black';
    }
    return null;
  }

  startTimer() {
    if (this.timerInterval) return; // Already started

    this.currentTurnStartTime = Date.now();
    this.gameStarted = true;

    this.timerInterval = setInterval(() => {
      const currentPlayer = this.game.turn() === 'w' ? 'white' : 'black';
      // Reduce time by 100ms
      this.timers[currentPlayer] = Math.max(0, this.timers[currentPlayer] - 100);
      // Broadcast timer update every second
      if (this.timers[currentPlayer] % 1000 === 0 || this.timers[currentPlayer] < 10000) {
        this.broadcastToRoom('timerUpdate', {
          timers: this.timers,
          currentTurn: currentPlayer
        });
      }
      // Check for timeout
      if (this.timers[currentPlayer] <= 0) {
        this.handleTimeout(currentPlayer);
      }
    }, 100);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  handleTimeout(player) {
    this.stopTimer();
    const winner = player === 'white' ? 'black' : 'white';
    this.broadcastToRoom('gameOver', {
      reason: 'timeout',
      winner,
      timers: this.timers
    });
    this.saveGame('timeout', winner);
  }

  makeMove(from, to, promotion) {
    try {
      const currentPlayer = this.game.turn();
      const move = this.game.move({ from, to, promotion: promotion || 'q' });
      if (move) {
        // Add increment after move
        const playerColor = currentPlayer === 'w' ? 'white' : 'black';
        this.timers[playerColor] += this.timeControl.increment;
        // Reset timer start time
        this.currentTurnStartTime = Date.now();
        return { success: true, move, fen: this.game.fen() };
      }
      return { success: false, error: 'Invalid move' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  addChatMessage(sender, message) {
    const chatMsg = {
      sender,
      message: message.substring(0, 200), // Limit message length
      timestamp: new Date()
    };
    this.chatMessages.push(chatMsg);
    this.broadcastToRoom('chatMessage', chatMsg);
  }

  isGameOver() {
    return this.game.isGameOver();
  }

  getGameStatus() {
    return {
      isCheck: this.game.isCheck(),
      isCheckmate: this.game.isCheckmate(),
      isDraw: this.game.isDraw(),
      isStalemate: this.game.isStalemate(),
      isThreefoldRepetition: this.game.isThreefoldRepetition(),
      isInsufficientMaterial: this.game.isInsufficientMaterial(),
      turn: this.game.turn()
    };
  }

  async saveGame(reason, winner) {
    try {
      this.stopTimer();
      // Update ELO ratings
      const result = winner === 'white' ? 'player1' :
                     winner === 'black' ? 'player2' : 'draw';
      const ratingUpdate = updateRatings(
        this.playerInfo.white,
        this.playerInfo.black,
        result
      );
      // Save game to database
      const game = new Game({
        whitePlayer: this.playerInfo.white.id,
        blackPlayer: this.playerInfo.black.id,
        moves: this.game.history({ verbose: true }),
        result: winner || 'draw',
        reason,
        whiteTime: this.timers.white,
        blackTime: this.timers.black,
        timeControl: this.timeControl,
        chatMessages: this.chatMessages,
        whiteRatingBefore: this.playerInfo.white.rating,
        blackRatingBefore: this.playerInfo.black.rating,
        whiteRatingAfter: ratingUpdate.player1.newRating,
        blackRatingAfter: ratingUpdate.player2.newRating,
        pgn: this.game.pgn(),
        fen: this.game.fen(),
        endedAt: new Date()
      });
      await game.save();
      // Update user stats and ratings
      if (this.playerInfo.white.id) {
        await User.findByIdAndUpdate(this.playerInfo.white.id, {
          $inc: {
            gamesPlayed: 1,
            [winner === 'white' ? 'wins' : winner ? 'losses' : 'draws']: 1
          },
          $set: { 
            rating: ratingUpdate.player1.newRating,
            lastActive: new Date()
          },
          $push: {
            ratingHistory: {
              rating: ratingUpdate.player1.newRating,
              date: new Date(),
              opponent: this.playerInfo.black.username,
              result: winner === 'white' ? 'win' : winner ? 'loss' : 'draw',
              ratingChange: ratingUpdate.player1.change
            }
          }
        });
      }
      if (this.playerInfo.black.id) {
        await User.findByIdAndUpdate(this.playerInfo.black.id, {
          $inc: {
            gamesPlayed: 1,
            [winner === 'black' ? 'wins' : winner ? 'losses' : 'draws']: 1
          },
          $set: { 
            rating: ratingUpdate.player2.newRating,
            lastActive: new Date()
          },
          $push: {
            ratingHistory: {
              rating: ratingUpdate.player2.newRating,
              date: new Date(),
              opponent: this.playerInfo.white.username,
              result: winner === 'black' ? 'win' : winner ? 'loss' : 'draw',
              ratingChange: ratingUpdate.player2.change
            }
          }
        });
      }
      // Broadcast rating changes
      this.broadcastToRoom('ratingUpdate', ratingUpdate);

      return { success: true, ratingUpdate };
    } catch (error) {
      console.error('Error saving game:', error);
      return { success: false, error: error.message };
    }
  }

  broadcastToRoom(event, data) {
    Object.values(this.sockets).forEach(socket => {
      socket.emit(event, data);
    });
    this.spectators.forEach(spectatorId => {
      io.to(spectatorId).emit(event, data);
    });
  }

  cleanup() {
    this.stopTimer();
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);
  activeSockets.set(socket.id, { socket, user: null });

  // Authentication
  socket.on('authenticate', async (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-password');
      if (user) {
        activeSockets.get(socket.id).user = user;
        socket.emit('authenticated', {
          username: user.username,
          rating: user.rating,
          gamesPlayed: user.gamesPlayed,
          wins: user.wins,
          losses: user.losses,
          draws: user.draws
        });
      }
    } catch {
      socket.emit('authError', { message: 'Invalid token' });
    }
  });

  // Find game
  socket.on('findGame', async ({ timeControl }) => {
    const socketData = activeSockets.get(socket.id);
    const userInfo = socketData.user || {
      username: `Guest${Math.floor(Math.random() * 1000)}`,
      rating: 1200,
      gamesPlayed: 0,
      id: null
    };

    if (waitingPlayers.length > 0) {
      // Match with waiting player
      const opponentSocket = waitingPlayers.shift();
      const opponentData = activeSockets.get(opponentSocket.id);
      const opponentInfo = opponentData.user || {
        username: `Guest${Math.floor(Math.random() * 1000)}`,
        rating: 1200,
        gamesPlayed: 0,
        id: null
      };

      const roomId = `game-${Date.now()}`;
      const gameRoom = new GameRoom(roomId, opponentSocket, timeControl, opponentInfo);
      gameRoom.addPlayer(socket, userInfo);
      games.set(roomId, gameRoom);

      // Notify both players
      opponentSocket.emit('gameStart', {
        roomId,
        color: 'white',
        opponent: userInfo,
        timeControl: gameRoom.timeControl,
        fen: gameRoom.game.fen()
      });

      socket.emit('gameStart', {
        roomId,
        color: 'black',
        opponent: opponentInfo,
        timeControl: gameRoom.timeControl,
        fen: gameRoom.game.fen()
      });

      // Start timer
      gameRoom.startTimer();
      console.log(`🎮 Game started: ${roomId}`);
    } else {
      // Add to waiting queue
      waitingPlayers.push(socket);
      socket.emit('waiting');
      console.log(`⏳ Player ${socket.id} waiting for opponent`);
    }
  });

  // Handle moves
  socket.on('move', async ({ roomId, from, to, promotion }) => {
    const gameRoom = games.get(roomId);
    if (!gameRoom) {
      socket.emit('error', { message: 'Game not found' });
      return;
    }
    // Verify it's the player's turn
    const currentTurn = gameRoom.game.turn();
    const playerColor = socket.id === gameRoom.players.white ? 'w' : 'b';

    if (currentTurn !== playerColor) {
      socket.emit('error', { message: 'Not your turn' });
      return;
    }

    const result = gameRoom.makeMove(from, to, promotion);

    if (result.success) {
      const status = gameRoom.getGameStatus();
      gameRoom.broadcastToRoom('moveMade', {
        move: result.move,
        fen: result.fen,
        status,
        timers: gameRoom.timers
      });

      // Check for game over
      if (gameRoom.isGameOver()) {
        let winner = null;
        if (status.isCheckmate) {
          winner = currentTurn === 'w' ? 'white' : 'black';
        }
        gameRoom.broadcastToRoom('gameOver', {
          reason: status.isCheckmate ? 'checkmate' : 
                  status.isStalemate ? 'stalemate' : 
                  status.isThreefoldRepetition ? 'threefold' : 
                  status.isInsufficientMaterial ? 'insufficient' : 'draw',
          winner
        });
        await gameRoom.saveGame(
          status.isCheckmate ? 'checkmate' : 'draw',
          winner
        );
        games.delete(roomId);
      }
    } else {
      socket.emit('invalidMove', { error: result.error });
    }
  });

  // Chat message
  socket.on('chatMessage', ({ roomId, message }) => {
    const gameRoom = games.get(roomId);
    if (gameRoom) {
      const socketData = activeSockets.get(socket.id);
      const username = socketData.user ? socketData.user.username : 'Guest';
      gameRoom.addChatMessage(username, message);
    }
  });

  // Resign
  socket.on('resign', async ({ roomId }) => {
    const gameRoom = games.get(roomId);
    if (gameRoom) {
      const resigningPlayer = socket.id === gameRoom.players.white ? 'white' : 'black';
      const winner = resigningPlayer === 'white' ? 'black' : 'white';
      gameRoom.broadcastToRoom('gameOver', {
        reason: 'resignation',
        winner
      });
      await gameRoom.saveGame('resignation', winner);
      games.delete(roomId);
    }
  });

  // Offer draw
  socket.on('offerDraw', ({ roomId }) => {
    const gameRoom = games.get(roomId);
    if (gameRoom) {
      const opponentId = socket.id === gameRoom.players.white ? 
                         gameRoom.players.black : gameRoom.players.white;
      io.to(opponentId).emit('drawOffered');
    }
  });

  // Accept draw
  socket.on('acceptDraw', async ({ roomId }) => {
    const gameRoom = games.get(roomId);
    if (gameRoom) {
      gameRoom.broadcastToRoom('gameOver', {
        reason: 'agreement',
        winner: null
      });
      await gameRoom.saveGame('agreement', null);
      games.delete(roomId);
    }
  });

  // Disconnect handling
  socket.on('disconnect', async () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
    // Remove from waiting list
    const waitingIndex = waitingPlayers.findIndex(s => s.id === socket.id);
    if (waitingIndex !== -1) {
      waitingPlayers.splice(waitingIndex, 1);
    }
    // Handle active games
    for (const [roomId, gameRoom] of games.entries()) {
      if (gameRoom.players.white === socket.id || gameRoom.players.black === socket.id) {
        const winner = gameRoom.players.white === socket.id ? 'black' : 'white';
        gameRoom.broadcastToRoom('gameOver', {
          reason: 'disconnect',
          winner
        });
        await gameRoom.saveGame('disconnect', winner);
        gameRoom.cleanup();
        games.delete(roomId);
      }
    }
    activeSockets.delete(socket.id);
  });
});

// REST API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeGames: games.size,
    waitingPlayers: waitingPlayers.length,
    activeSockets: activeSockets.size
  });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      username,
      email,
      password: hashedPassword
    });

    await user.save();

    // Create token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        rating: user.rating
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }
    // Create token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '7d'
    });
    // Update last active
    user.lastActive = new Date();
    await user.save();
    res.json({
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        rating: user.rating,
        gamesPlayed: user.gamesPlayed,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const users = await User.find({ gamesPlayed: { $gte: 5 } })
      .sort({ rating: -1 })
      .limit(limit)
      .select('username rating gamesPlayed wins losses draws');
    res.json(users);
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chess Pro Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});

module.exports = server;
