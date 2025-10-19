const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  rating: {
    type: Number,
    default: 1200,
    min: 100,
    max: 3000
  },
  gamesPlayed: { type: Number, default: 0 },
  wins: { type: Number, default: 0 },
  losses: { type: Number, default: 0 },
  draws: { type: Number, default: 0 },
  ratingHistory: [{ rating: Number, date: Date, opponent: String, result: String }],
  selectedTheme: { type: String, default: 'classic' },
  createdAt: { type: Date, default: Date.now }
});

userSchema.index({ rating: -1 });
userSchema.index({ username: 1 });

module.exports = mongoose.model('User', userSchema);
