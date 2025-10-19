const mongoose = require('mongoose');

const gameSchema = new mongoose.Schema({
  whitePlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  blackPlayer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  moves: [{ from: String, to: String, san: String, timestamp: Date }],
  result: { type: String, enum: ['white', 'black', 'draw', 'ongoing'], default: 'ongoing' },
  reason: { type: String },
  whiteTime: Number,
  blackTime: Number,
  timeControl: { initial: Number, increment: Number },
  chatMessages: [{ sender: String, message: String, timestamp: Date }],
  pgn: String,
  fen: String,
  startedAt: { type: Date, default: Date.now },
  endedAt: Date
});

module.exports = mongoose.model('Game', gameSchema);
