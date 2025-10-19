// ==================== Global Variables ====================
let socket;
let game;
let playerColor;
let roomId;
let selectedSquare = null;
let gameActive = false;
let isFlipped = false;
let authToken = null;
let currentUser = null;
let timerInterval = null;

// Piece Unicode symbols
const pieceSymbols = {
    'wp': '♙', 'wn': '♘', 'wb': '♗', 'wr': '♖', 'wq': '♕', 'wk': '♔',
    'bp': '♟', 'bn': '♞', 'bb': '♝', 'br': '♜', 'bq': '♛', 'bk': '♚'
};

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    authToken = localStorage.getItem('chessAuthToken');
    if (authToken) {
        currentUser = JSON.parse(localStorage.getItem('chessUser') || '{}');
        updateUserDisplay();
    }
    initializeSocket();
    initializeGame();
    setupEventListeners();
});

// ==================== Socket.IO ====================
function initializeSocket() {
    socket = io({
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
    });

    socket.on('connect', () => {
        updateStatus('Connected! Ready to play');
        if (authToken) {
            socket.emit('authenticate', authToken);
        }
    });

    socket.on('authenticated', (userData) => {
        currentUser = userData;
        localStorage.setItem('chessUser', JSON.stringify(userData));
        updateUserDisplay();
        updateStatsDisplay(userData);
    });

    socket.on('waiting', () => {
        updateStatus('🔍 Searching for opponent...');
        disableGameControls();
        document.getElementById('findGameBtn').disabled = true;
        document.getElementById('findGameBtn').innerHTML = '<span>⏳</span> Searching...';
    });

    socket.on('gameStart', (data) => {
        roomId = data.roomId;
        playerColor = data.color;
        gameActive = true;
        updateStatus(`Game started! You are ${playerColor}`);
        document.getElementById('findGameBtn').style.display = 'none';
        document.getElementById('opponentName').textContent = data.opponent.username;
        document.getElementById('opponentRating').textContent = data.opponent.rating;
        updatePlayerColors();
        enableGameControls();
        if (playerColor === 'black' && !isFlipped) flipBoard();
        initializeTimers(data.timeControl);
        renderBoard();
    });

    socket.on('moveMade', (data) => {
        game.load(data.fen);
        renderBoard();
        addMoveToHistory(data.move);
        if (data.status.isCheck) {
            updateStatus(`⚠️ Check! ${data.status.turn === 'w' ? 'White' : 'Black'} to move`);
        } else {
            const yourTurn = game.turn() === playerColor[0];
            updateStatus(yourTurn ? '✅ Your turn' : '⏳ Opponent\'s turn');
        }
        if (data.timers) updateTimerDisplays(data.timers);
    });

    socket.on('timerUpdate', (data) => {
        updateTimerDisplays(data.timers);
    });

    socket.on('gameOver', (data) => {
        gameActive = false;
        stopTimers();
        disableGameControls();
        setTimeout(() => showGameOverModal(data), 500);
    });

    socket.on('ratingUpdate', (data) => {
        displayRatingChanges(data);
        if (currentUser) {
            if (playerColor === 'white') currentUser.rating = data.player1.newRating;
            else currentUser.rating = data.player2.newRating;
            updateUserDisplay();
        }
    });

    socket.on('chatMessage', (data) => {
        addChatMessage(data.sender, data.message, data.timestamp);
    });

    socket.on('drawOffered', () => {
        showDrawOfferModal();
    });

    socket.on('invalidMove', (data) => {
        updateStatus('❌ Invalid move!');
    });

    socket.on('error', (data) => {
        updateStatus('❌ ' + data.message);
    });

    socket.on('disconnect', () => {
        updateStatus('Disconnected from server');
        gameActive = false;
        stopTimers();
        disableGameControls();
    });
}

// ==================== Game Initialization ====================
function initializeGame() {
    game = new Chess();
    renderBoard();
}

// ==================== Event Listeners ====================
function setupEventListeners() {
    document.getElementById('findGameBtn').addEventListener('click', () => {
        const timeControl = document.getElementById('timeControl').value;
        socket.emit('findGame', { timeControl });
    });

    document.getElementById('resignBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to resign?')) {
            socket.emit('resign', { roomId });
        }
    });

    document.getElementById('drawBtn').addEventListener('click', () => {
        socket.emit('offerDraw', { roomId });
        updateStatus('Draw offer sent');
    });

    document.getElementById('flipBoardBtn').addEventListener('click', () => {
        flipBoard();
    });

    document.getElementById('sendChatBtn').addEventListener('click', sendChatMessage);
    document.getElementById('chatInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const message = btn.dataset.msg;
            socket.emit('chatMessage', { roomId, message });
        });
    });

    document.getElementById('exportPGNBtn').addEventListener('click', exportPGN);

    document.getElementById('themeSelect').addEventListener('change', (e) => {
        changeTheme(e.target.value);
    });

    document.getElementById('authBtn').addEventListener('click', () => {
        if (authToken) logout();
        else showAuthModal();
    });

    document.getElementById('toggleAuthMode').addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthMode();
    });

    document.getElementById('closeAuthModal').addEventListener('click', hideAuthModal);

    document.getElementById('authForm').addEventListener('submit', handleAuth);

    document.getElementById('newGameBtn').addEventListener('click', () => {
        hideGameOverModal();
        location.reload();
    });
    document.getElementById('closeModalBtn').addEventListener('click', hideGameOverModal);

    document.getElementById('acceptDrawBtn').addEventListener('click', () => {
        socket.emit('acceptDraw', { roomId });
        hideDrawOfferModal();
    });
    document.getElementById('declineDrawBtn').addEventListener('click', hideDrawOfferModal);
}

// ==================== Board Rendering ====================
function renderBoard() {
    const board = document.getElementById('chessboard');
    board.innerHTML = '';
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const displayRow = isFlipped ? row : 7 - row;
            const displayCol = isFlipped ? 7 - col : col;
            const square = String.fromCharCode(97 + displayCol) + (displayRow + 1);
            const piece = game.get(square);
            const squareDiv = document.createElement('div');
            squareDiv.className = 'square';
            squareDiv.dataset.square = square;
            if (piece) {
                const pieceSpan = document.createElement('span');
                pieceSpan.textContent = pieceSymbols[piece.color + piece.type];
                squareDiv.appendChild(pieceSpan);
            }
            squareDiv.addEventListener('click', () => handleSquareClick(square));
            board.appendChild(squareDiv);
        }
    }
}

function handleSquareClick(square) {
    if (!gameActive) return;
    if (game.turn() !== playerColor[0]) {
        updateStatus('⏳ Wait for your turn');
        return;
    }
    const piece = game.get(square);
    if (selectedSquare) {
        if (selectedSquare === square) {
            selectedSquare = null;
            renderBoard();
        } else {
            const move = { from: selectedSquare, to: square, promotion: 'q' };
            const moves = game.moves({ square: selectedSquare, verbose: true });
            const isLegal = moves.some(m => m.to === square);
            if (isLegal) {
                socket.emit('move', { roomId, ...move });
                selectedSquare = null;
            } else {
                updateStatus('❌ Illegal move');
            }
            renderBoard();
        }
    } else if (piece && piece.color === playerColor[0]) {
        selectedSquare = square;
        renderBoard();
        highlightSquare(square);
        showValidMoves(square);
    }
}

function highlightSquare(square) {
    const squareEl = document.querySelector(`[data-square="${square}"]`);
    if (squareEl) squareEl.classList.add('selected');
}
function showValidMoves(square) {
    const moves = game.moves({ square, verbose: true });
    moves.forEach(move => {
        const targetEl = document.querySelector(`[data-square="${move.to}"]`);
        if (targetEl) {
            targetEl.classList.add(move.captured ? 'capture' : 'valid-move');
        }
    });
}

// ==================== Timer Functions ====================
function initializeTimers(timeControl) {
    const whiteTimer = document.getElementById('yourTimer').querySelector('.timer-text');
    const blackTimer = document.getElementById('opponentTimer').querySelector('.timer-text');
    whiteTimer.textContent = formatTime(timeControl.initial);
    blackTimer.textContent = formatTime(timeControl.initial);
}
function updateTimerDisplays(timers) {
    const yourTimerEl = document.getElementById('yourTimer');
    const oppTimerEl = document.getElementById('opponentTimer');
    const yourTime = playerColor === 'white' ? timers.white : timers.black;
    const oppTime = playerColor === 'white' ? timers.black : timers.white;
    yourTimerEl.querySelector('.timer-text').textContent = formatTime(yourTime);
    oppTimerEl.querySelector('.timer-text').textContent = formatTime(oppTime);
    if (yourTime < 30000) yourTimerEl.classList.add('warning');
    else yourTimerEl.classList.remove('warning');
    if (oppTime < 30000) oppTimerEl.classList.add('warning');
    else oppTimerEl.classList.remove('warning');
}
function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
function stopTimers() { if (timerInterval) clearInterval(timerInterval); }

// ==================== Chat Functions ====================
function sendChatMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (message && roomId) {
        socket.emit('chatMessage', { roomId, message });
        input.value = '';
    }
}
function addChatMessage(sender, message, timestamp) {
    const chatMessages = document.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';
    const time = new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    msgDiv.innerHTML = `
        <div class="chat-sender">${sender}</div>
        <div class="chat-text">${escapeHtml(message)}</div>
        <div class="chat-time">${time}</div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== Move History ====================
function addMoveToHistory(move) {
    const moveHistory = document.getElementById('moveHistory');
    const moveDiv = document.createElement('div');
    moveDiv.className = 'move-item';
    const moveNumber = Math.floor(game.history().length / 2) + 1;
    const color = move.color === 'w' ? 'White' : 'Black';
    moveDiv.textContent = `${moveNumber}. ${color}: ${move.san}`;
    moveHistory.appendChild(moveDiv);
    moveHistory.scrollTop = moveHistory.scrollHeight;
}
function exportPGN() {
    const pgn = game.pgn();
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chess-game-${Date.now()}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== UI Functions ====================
function updateStatus(text) {
    document.getElementById('statusText').textContent = text;
}
function updateUserDisplay() {
    if (currentUser) {
        document.getElementById('username').textContent = currentUser.username;
        document.getElementById('userRating').textContent = currentUser.rating;
        document.getElementById('yourName').textContent = currentUser.username;
        document.getElementById('yourRating').textContent = currentUser.rating;
        document.getElementById('authBtn').textContent = 'Logout';
    }
}
function updateStatsDisplay(userData) {
    document.getElementById('totalGames').textContent = userData.gamesPlayed || 0;
    document.getElementById('totalWins').textContent = userData.wins || 0;
    document.getElementById('totalLosses').textContent = userData.losses || 0;
    document.getElementById('totalDraws').textContent = userData.draws || 0;
    const winRate = userData.gamesPlayed > 0 ? Math.round((userData.wins / userData.gamesPlayed) * 100) : 0;
    document.getElementById('winRate').textContent = `${winRate}%`;
}
function updatePlayerColors() {
    const yourColor = document.querySelector('.your-panel .color-indicator');
    const oppColor = document.querySelector('.opponent-panel .color-indicator');
    if (playerColor === 'white') {
        yourColor.style.background = '#ecf0f1';
        oppColor.style.background = '#2c3e50';
    } else {
        yourColor.style.background = '#2c3e50';
        oppColor.style.background = '#ecf0f1';
    }
}
function flipBoard() { isFlipped = !isFlipped; renderBoard(); }
function changeTheme(theme) {
    const board = document.getElementById('chessboard');
    board.className = `chessboard theme-${theme}`;
}
function enableGameControls() {
    document.getElementById('resignBtn').disabled = false;
    document.getElementById('drawBtn').disabled = false;
    document.getElementById('chatInput').disabled = false;
    document.getElementById('sendChatBtn').disabled = false;
    document.getElementById('exportPGNBtn').disabled = false;
}
function disableGameControls() {
    document.getElementById('resignBtn').disabled = true;
    document.getElementById('drawBtn').disabled = true;
    document.getElementById('chatInput').disabled = true;
    document.getElementById('sendChatBtn').disabled = true;
}

// ==================== Modal Functions ====================
function showGameOverModal(data) {
    const modal = document.getElementById('gameOverModal');
    const resultDiv = document.getElementById('gameResult');
    const messageDiv = document.getElementById('gameOverMessage');
    let resultText = '';
    if (data.reason === 'checkmate') {
        resultText = data.winner === playerColor ? '🎉 You Won!' : '😔 You Lost';
    } else if (data.reason === 'timeout') {
        resultText = data.winner === playerColor ? '⏰ Opponent Timed Out - You Win!' : '⏰ You Timed Out';
    } else if (data.reason === 'resignation') {
        resultText = data.winner === playerColor ? '🏳️ Opponent Resigned - You Win!' : '🏳️ You Resigned';
    } else {
        resultText = '🤝 Draw';
    }
    resultDiv.textContent = resultText;
    messageDiv.textContent = `Reason: ${data.reason}`;
    modal.classList.add('show');
}
function hideGameOverModal() {
    document.getElementById('gameOverModal').classList.remove('show');
}
function displayRatingChanges(data) {
    const changesDiv = document.getElementById('ratingChanges');
    const yourChange = playerColor === 'white' ? data.player1.change : data.player2.change;
    const yourNewRating = playerColor === 'white' ? data.player1.newRating : data.player2.newRating;
    const changeClass = yourChange > 0 ? 'positive' : 'negative';
    const changeSign = yourChange > 0 ? '+' : '';
    changesDiv.innerHTML = `
        <div class="rating-change">
            <div>Your Rating</div>
            <div class="rating-change-value ${changeClass}">
                ${yourNewRating} (${changeSign}${yourChange})
            </div>
        </div>
    `;
}
function showDrawOfferModal() {
    document.getElementById('drawOfferModal').classList.add('show');
}
function hideDrawOfferModal() {
    document.getElementById('drawOfferModal').classList.remove('show');
}

// ==================== Authentication ====================
function showAuthModal() { document.getElementById('authModal').classList.add('show'); }
function hideAuthModal() { document.getElementById('authModal').classList.remove('show'); }
function toggleAuthMode() {
    const isLogin = document.getElementById('authModalTitle').textContent === 'Login';
    if (isLogin) {
        document.getElementById('authModalTitle').textContent = 'Register';
        document.getElementById('usernameGroup').style.display = 'block';
        document.getElementById('authBtnText').textContent = 'Register';
        document.getElementById('authToggleText').textContent = 'Already have an account?';
        document.getElementById('toggleAuthMode').textContent = 'Login';
    } else {
        document.getElementById('authModalTitle').textContent = 'Login';
        document.getElementById('usernameGroup').style.display = 'none';
        document.getElementById('authBtnText').textContent = 'Login';
        document.getElementById('authToggleText').textContent = "Don't have an account?";
        document.getElementById('toggleAuthMode').textContent = 'Register';
    }
}
async function handleAuth(e) {
    e.preventDefault();
    const isLogin = document.getElementById('authModalTitle').textContent === 'Login';
    const email = document.getElementById('authEmail').value;
    const password = document.getElementById('authPassword').value;
    const username = document.getElementById('authUsername').value;
    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const body = isLogin ? { email, password } : { username, email, password };
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await response.json();
        if (response.ok) {
            authToken = data.token;
            currentUser = data.user;
            localStorage.setItem('chessAuthToken', authToken);
            localStorage.setItem('chessUser', JSON.stringify(currentUser));
            updateUserDisplay();
            updateStatsDisplay(currentUser);
            hideAuthModal();
            socket.emit('authenticate', authToken);
            document.getElementById('authError').textContent = '';
        } else {
            document.getElementById('authError').textContent = data.error || 'Authentication failed';
        }
    } catch (error) {
        document.getElementById('authError').textContent = 'Connection error';
    }
}
function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('chessAuthToken');
    localStorage.removeItem('chessUser');
    document.getElementById('username').textContent = 'Guest';
    document.getElementById('userRating').textContent = '1200';
    document.getElementById('authBtn').textContent = 'Login';
    location.reload();
}

