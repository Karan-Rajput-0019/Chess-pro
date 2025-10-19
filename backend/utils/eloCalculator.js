function getExpectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function calculateNewRating(currentRating, opponentRating, actualScore, kFactor = 32) {
  const expectedScore = getExpectedScore(currentRating, opponentRating);
  const ratingChange = Math.round(kFactor * (actualScore - expectedScore));
  return currentRating + ratingChange;
}

function getKFactor(rating, gamesPlayed) {
  if (gamesPlayed < 30) return 40;
  if (rating < 2100) return 32;
  if (rating < 2400) return 24;
  return 16;
}

function updateRatings(player1, player2, result) {
  const k1 = getKFactor(player1.rating, player1.gamesPlayed || 0);
  const k2 = getKFactor(player2.rating, player2.gamesPlayed || 0);
  let score1, score2;
  if (result === 'player1') { score1 = 1; score2 = 0; }
  else if (result === 'player2') { score1 = 0; score2 = 1; }
  else { score1 = 0.5; score2 = 0.5; }
  const newRating1 = calculateNewRating(player1.rating, player2.rating, score1, k1);
  const newRating2 = calculateNewRating(player2.rating, player1.rating, score2, k2);
  return {
    player1: { oldRating: player1.rating, newRating: newRating1, change: newRating1 - player1.rating },
    player2: { oldRating: player2.rating, newRating: newRating2, change: newRating2 - player2.rating }
  };
}

module.exports = { getExpectedScore, calculateNewRating, getKFactor, updateRatings };
