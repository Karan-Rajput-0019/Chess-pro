const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  format: { type: String, enum: ['single-elimination', 'double-elimination', 'round-robin', 'swiss'], default: 'single-elimination' },
  timeControl: { initial: Number, increment: Number },
  maxPlayers: { type: Number, required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: ['registration', 'in-progress', 'completed'], default: 'registration' },
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', tournamentSchema);
