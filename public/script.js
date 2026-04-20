const socket = io();
const ChessCtor = window.Chess;

if (typeof ChessCtor === "undefined") {
  console.error("Chess.js не загружен: window.Chess отсутствует");
  window.addEventListener("DOMContentLoaded", () => {
    const toast = document.getElementById("toast");
    const createButton = document.getElementById("createRoomBtn");
    const joinButton = document.getElementById("joinRoomBtn");
    if (createButton) createButton.disabled = true;
    if (joinButton) joinButton.disabled = true;
    if (toast) {
      toast.textContent = "Ошибка загрузки шахматного движка. Обновите страницу.";
      toast.classList.remove("hidden");
    }
  });
  throw new Error("Chess is not defined");
}

const chess = new ChessCtor();

const NORMAL_HINT_DELAY_MS = 30000;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_TYPES = {
  p: "P",
  n: "N",
  b: "B",
  r: "R",
  q: "Q",
  k: "K"
};
const PIECE_ASSETS = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"];
const DEFAULT_TITLE = "Шахматы";

const state = {
  roomId: "",
  myColor: null,
  difficulty: "easy",
  selectedSquare: null,
  legalMoves: [],
  lastMove: null,
  hintUnlocked: true,
  hintTimer: null,
  gameStarted: false,
  gameOver: false,
  unreadMessages: 0,
  chatOpen: false,
  notificationPermissionRequested: false,
  drag: {
    active: false,
    from: null,
    legalMoves: [],
    hoverSquare: null,
    ghost: null,
    moved: false,
    startX: 0,
    startY: 0
  }
};

const refs = {
  menuScreen: document.getElementById("menuScreen"),
  gameScreen: document.getElementById("gameScreen"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  board: document.getElementById("board"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  myColorLabel: document.getElementById("myColorLabel"),
  turnLabel: document.getElementById("turnLabel"),
  opponentStatus: document.getElementById("opponentStatus"),
  difficultySelect: document.getElementById("difficultySelect"),
  difficultyLabel: document.getElementById("difficultyLabel"),
  copyRoomCodeBtn: document.getElementById("copyRoomCodeBtn"),
  copyRoomCodeInlineBtn: document.getElementById("copyRoomCodeInlineBtn"),
  historyList: document.getElementById("historyList"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  blackTimer: document.getElementById("blackTimer"),
  whiteTimer: document.getElementById("whiteTimer"),
  resignBtn: document.getElementById("resignBtn"),
  offerDrawBtn: document.getElementById("offerDrawBtn"),
  newGameBtn: document.getElementById("newGameBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  toast: document.getElementById("toast"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalText: document.getElementById("modalText"),
  modalActions: document.getElementById("modalActions"),
  chatTabButton: document.querySelector(".tab-chat")
};

const sanitizeText = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const showToast = (message) => {
  refs.toast.textContent = message;
  refs.toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.add("hidden"), 2300);
};

const updateChatBadge = () => {
  const tab = refs.chatTabButton;
  if (!tab) return;
  let badge = tab.querySelector(".badge");

  if (state.unreadMessages > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "badge";
      tab.appendChild(badge);
    }
    badge.textContent = state.unreadMessages > 9 ? "9+" : String(state.unreadMessages);
    tab.classList.add("has-unread");
  } else {
    if (badge) badge.remove();
    tab.classList.remove("has-unread");
  }
  document.title = state.unreadMessages > 0 ? `(${state.unreadMessages}) ${DEFAULT_TITLE}` : DEFAULT_TITLE;
};

const playNotificationSound = () => {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (_error) {
    // Ignore blocked audio policies.
  }
};

const openModal = ({ title, text, actions }) => {
  refs.modalTitle.textContent = title;
  refs.modalText.textContent = text;
  refs.modalActions.innerHTML = "";
  actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action.label;
    if (action.className) button.className = action.className;
    button.addEventListener("click", () => {
      refs.modal.classList.add("hidden");
      action.onClick?.();
    });
    refs.modalActions.appendChild(button);
  });
  refs.modal.classList.remove("hidden");
};

const getDifficultyLabel = (difficulty) => {
  if (difficulty === "normal") return "Нормальный";
  if (difficulty === "hard") return "Сложный";
  return "Лёгкий";
};

const toSquare = (row, col, forBlack) => {
  const fileIndex = forBlack ? 7 - col : col;
  const rank = forBlack ? row + 1 : 8 - row;
  return `${FILES[fileIndex]}${rank}`;
};

const formatTimer = (seconds) => {
  const clamped = Math.max(0, seconds);
  const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
  const ss = String(clamped % 60).padStart(2, "0");
  return `${mm}:${ss}`;
};

const canShowHints = () => {
  if (state.difficulty === "hard") return false;
  if (state.difficulty === "normal") return state.hintUnlocked;
  return true;
};

const vibrateMove = () => {
  if ("vibrate" in navigator) navigator.vibrate(30);
};

const isMyTurn = () => (chess.turn() === "w" ? "white" : "black") === state.myColor;
const myPieceColorCode = () => (state.myColor === "white" ? "w" : "b");

const isInCheck = () => {
  if (typeof chess.inCheck === "function") return chess.inCheck();
  if (typeof chess.in_check === "function") return chess.in_check();
  return false;
};

const updateTurnUi = () => {
  const turn = chess.turn() === "w" ? "white" : "black";
  refs.turnLabel.textContent = turn === "white" ? "⚪ Белые" : "⚫ Чёрные";
  refs.whiteTimer.classList.toggle("active", turn === "white");
  refs.blackTimer.classList.toggle("active", turn === "black");
};

const scheduleNormalHints = () => {
  clearTimeout(state.hintTimer);
  state.hintUnlocked = state.difficulty !== "normal";

  const myTurn = (chess.turn() === "w" ? "white" : "black") === state.myColor;
  if (state.difficulty === "normal" && myTurn && !state.gameOver) {
    state.hintTimer = setTimeout(() => {
      state.hintUnlocked = true;
      renderBoard();
      showToast("Подсказки активированы для этого хода");
    }, NORMAL_HINT_DELAY_MS);
  }
};

const clearSelection = () => {
  state.selectedSquare = null;
  state.legalMoves = [];
};

const clearDragState = () => {
  if (state.drag.ghost) state.drag.ghost.remove();
  state.drag.active = false;
  state.drag.from = null;
  state.drag.legalMoves = [];
  state.drag.hoverSquare = null;
  state.drag.ghost = null;
  state.drag.moved = false;
  state.drag.startX = 0;
  state.drag.startY = 0;
};

const findHoverSquare = (clientX, clientY) => {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) return null;
  const cell = element.closest(".square");
  return cell?.dataset.square || null;
};

const updateDragGhost = (clientX, clientY) => {
  if (!state.drag.ghost) return;
  state.drag.ghost.style.left = `${clientX}px`;
  state.drag.ghost.style.top = `${clientY}px`;
};

const showMovesForSquare = (square) => {
  state.selectedSquare = square;
  state.legalMoves = chess.moves({ square, verbose: true });
  const selected = chess.get(square);
  if (selected?.type === "p") {
    console.log("[pawn-debug]", {
      from: square,
      color: selected.color,
      moves: state.legalMoves.map((m) => ({ to: m.to, flags: m.flags, captured: m.captured || null }))
    });
  }
};

const startDrag = (fromSquare, clientX, clientY) => {
  if (!state.gameStarted || state.gameOver || !isMyTurn()) return false;
  const piece = chess.get(fromSquare);
  if (!piece || piece.color !== myPieceColorCode()) return false;

  const legalMoves = chess.moves({ square: fromSquare, verbose: true });
  state.drag.active = true;
  state.drag.from = fromSquare;
  state.drag.legalMoves = legalMoves;
  state.drag.hoverSquare = null;
  state.drag.moved = false;
  state.drag.startX = clientX;
  state.drag.startY = clientY;

  showMovesForSquare(fromSquare);

  const ghost = document.createElement("div");
  ghost.className = "drag-ghost piece";
  ghost.style.backgroundImage = `url('/pieces/${piece.color}${PIECE_TYPES[piece.type]}.svg')`;
  document.body.appendChild(ghost);
  state.drag.ghost = ghost;
  updateDragGhost(clientX, clientY);
  renderBoard();
  return true;
};

const updateDrag = (clientX, clientY) => {
  if (!state.drag.active) return;
  state.drag.moved = true;
  updateDragGhost(clientX, clientY);
  state.drag.hoverSquare = findHoverSquare(clientX, clientY);
  renderBoard();
};

const finishDrag = (tapSquare = null) => {
  if (!state.drag.active) return;
  const from = state.drag.from;
  const to = state.drag.hoverSquare;
  const valid = state.drag.legalMoves.some((move) => move.to === to);
  const hadMovement = state.drag.moved;

  clearDragState();

  if (!hadMovement && tapSquare) {
    onCellClick(tapSquare);
    return;
  }

  if (!hadMovement) {
    renderBoard();
    return;
  }

  if (valid && from && to) {
    clearSelection();
    renderBoard();
    tryMove(from, to);
    return;
  }

  renderBoard();
};

const renderHistory = (history) => {
  refs.historyList.innerHTML = "";
  history.forEach((item, index) => {
    const li = document.createElement("li");
    li.textContent = item;
    refs.historyList.appendChild(li);
    if (index === history.length - 1) {
      li.scrollIntoView({ block: "end" });
    }
  });
};

const renderBoard = () => {
  refs.board.innerHTML = "";
  const forBlack = state.myColor === "black";
  const board = chess.board();
  const showHintsNow = canShowHints();

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = toSquare(row, col, forBlack);
      const file = square.charCodeAt(0) - "a".charCodeAt(0);
      const rank = Number(square[1]) - 1;
      const piece = board[7 - rank][file];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
      cell.dataset.square = square;
      cell.setAttribute("aria-label", square);

      if (piece) {
        const pieceEl = document.createElement("div");
        pieceEl.className = "piece";
        pieceEl.style.backgroundImage = `url('/pieces/${piece.color}${PIECE_TYPES[piece.type]}.svg')`;
        cell.appendChild(pieceEl);
      }
      if (state.selectedSquare === square) cell.classList.add("selected");
      if (state.drag.active && state.drag.from === square) cell.classList.add("drag-source");
      if (state.drag.active && state.drag.hoverSquare === square) cell.classList.add("drag-over");
      if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) {
        cell.classList.add("last-move");
      }

      if (showHintsNow && state.selectedSquare) {
        const move = state.legalMoves.find((item) => item.to === square);
        if (move) {
          const isCapture = Boolean(move.captured) || String(move.flags || "").includes("c") || String(move.flags || "").includes("e");
          if (isCapture) cell.classList.add("hint-capture");
          else cell.classList.add("hint-dot");
        }
      }

      const checkColor = chess.turn() === "w" ? "w" : "b";
      if (piece?.type === "k" && piece.color === checkColor && isInCheck()) {
        cell.classList.add("in-check");
      }

      if (square[0] === "a") {
        const rankEl = document.createElement("span");
        rankEl.className = "coord-rank";
        rankEl.textContent = square[1];
        cell.appendChild(rankEl);
      }
      if (square[1] === "1") {
        const fileEl = document.createElement("span");
        fileEl.className = "coord-file";
        fileEl.textContent = square[0];
        cell.appendChild(fileEl);
      }

      cell.addEventListener("click", () => onCellClick(square));
      cell.addEventListener("mouseenter", () => {
        if (!state.gameStarted || state.gameOver || !isMyTurn()) return;
        if (state.difficulty !== "easy" || state.drag.active) return;
        const hovered = chess.get(square);
        if (!hovered || hovered.color !== myPieceColorCode()) return;
        showMovesForSquare(square);
        renderBoard();
      });
      cell.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        if (!startDrag(square, event.clientX, event.clientY)) return;
        event.preventDefault();
      });
      cell.addEventListener(
        "touchstart",
        (event) => {
          const touch = event.touches[0];
          if (!touch) return;
          if (!startDrag(square, touch.clientX, touch.clientY)) return;
          event.preventDefault();
        },
        { passive: false }
      );
      refs.board.appendChild(cell);
    }
  }
};

const emitMove = ({ from, to, promotion }) => {
  socket.emit("move", { roomId: state.roomId, from, to, promotion });
};

const requestPromotion = (callback) => {
  openModal({
    title: "Превращение пешки",
    text: "Выберите фигуру:",
    actions: [
      { label: "Ферзь", onClick: () => callback("q") },
      { label: "Ладья", onClick: () => callback("r") },
      { label: "Слон", onClick: () => callback("b") },
      { label: "Конь", onClick: () => callback("n") }
    ]
  });
};

const tryMove = (from, to) => {
  const piece = chess.get(from);
  if (!piece) return;

  const isPromotion =
    piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"));

  if (isPromotion) {
    requestPromotion((promotion) => emitMove({ from, to, promotion }));
    return;
  }
  emitMove({ from, to });
};

const onCellClick = (square) => {
  if (state.drag.active) return;
  if (!state.gameStarted || state.gameOver) return;

  if (!isMyTurn()) return;

  const piece = chess.get(square);

  if (state.selectedSquare && state.selectedSquare !== square) {
    const canMoveThere = state.legalMoves.some((m) => m.to === square);
    if (canMoveThere || !piece || piece.color !== myPieceColorCode()) {
      const from = state.selectedSquare;
      clearSelection();
      renderBoard();
      tryMove(from, square);
      return;
    }
  }

  if (!piece || piece.color !== myPieceColorCode()) {
    clearSelection();
    renderBoard();
    return;
  }

  showMovesForSquare(square);
  renderBoard();
};

const updateTimers = ({ white, black }) => {
  refs.whiteTimer.textContent = formatTimer(white);
  refs.blackTimer.textContent = formatTimer(black);
  refs.whiteTimer.classList.toggle("danger", white <= 30);
  refs.blackTimer.classList.toggle("danger", black <= 30);
};

const enterGameScreen = () => {
  refs.menuScreen.classList.add("hidden");
  refs.gameScreen.classList.remove("hidden");
  refs.roomCodeLabel.textContent = state.roomId;
  refs.myColorLabel.textContent = state.myColor === "white" ? "⚪ Белые" : "⚫ Чёрные";
  refs.difficultyLabel.textContent = getDifficultyLabel(state.difficulty);
  updateTurnUi();
  renderBoard();
};

const resetToMenu = () => {
  clearSelection();
  clearDragState();
  chess.reset();
  state.roomId = "";
  state.myColor = null;
  state.gameStarted = false;
  state.gameOver = false;
  state.lastMove = null;
  clearTimeout(state.hintTimer);

  refs.menuScreen.classList.remove("hidden");
  refs.gameScreen.classList.add("hidden");
  refs.copyLinkBtn.classList.add("hidden");
  refs.historyList.innerHTML = "";
  refs.chatMessages.innerHTML = "";
};

document.addEventListener("mousemove", (event) => {
  if (!state.drag.active) return;
  updateDrag(event.clientX, event.clientY);
});

document.addEventListener("mouseup", () => {
  finishDrag();
});

refs.board.addEventListener(
  "touchmove",
  (event) => {
    if (!state.drag.active) return;
    const touch = event.touches[0];
    if (!touch) return;
    const deltaX = Math.abs(touch.clientX - state.drag.startX);
    const deltaY = Math.abs(touch.clientY - state.drag.startY);
    // Treat tiny movement as a tap; avoid accidental drag on touch screens.
    if (deltaX < 8 && deltaY < 8) {
      event.preventDefault();
      return;
    }
    updateDrag(touch.clientX, touch.clientY);
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "touchend",
  (event) => {
    if (!state.drag.active) return;
    const touch = event.changedTouches?.[0];
    const tapSquare = touch ? findHoverSquare(touch.clientX, touch.clientY) : null;
    finishDrag(tapSquare);
    event.preventDefault();
  },
  { passive: false }
);

document.addEventListener(
  "touchcancel",
  (event) => {
    finishDrag();
    event.preventDefault();
  },
  { passive: false }
);

refs.board.addEventListener(
  "touchend",
  (event) => {
    // Block emulated click after touch to prevent double-trigger.
    event.preventDefault();
  },
  { passive: false }
);

refs.board.addEventListener(
  "touchstart",
  (event) => {
    // Keep scrolling/zoom gestures from hijacking board taps.
    event.preventDefault();
  },
  { passive: false }
);

const appendChat = ({ color, message }) => {
  const row = document.createElement("div");
  row.className = "chat-line";
  row.innerHTML = `<b>${color === "white" ? "⚪" : "⚫"}</b>${sanitizeText(message)}`;
  refs.chatMessages.appendChild(row);
  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
};

refs.createRoomBtn.addEventListener("click", () => {
  socket.emit("createRoom", { difficulty: refs.difficultySelect.value });
});

refs.joinRoomBtn.addEventListener("click", () => {
  const roomId = refs.roomCodeInput.value.trim().toUpperCase();
  if (roomId.length !== 6) {
    showToast("Введите 6-значный код комнаты");
    return;
  }
  socket.emit("joinRoom", roomId);
});

refs.copyLinkBtn.addEventListener("click", async () => {
  const url = `${window.location.origin}/?room=${state.roomId}`;
  await navigator.clipboard.writeText(url);
  showToast("Ссылка скопирована");
});

refs.copyRoomCodeBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.roomId);
  showToast("Код комнаты скопирован");
});

refs.copyRoomCodeInlineBtn?.addEventListener("click", async () => {
  await navigator.clipboard.writeText(state.roomId);
  showToast("Код комнаты скопирован");
});

refs.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = refs.chatInput.value.trim();
  if (!message) return;
  if ("Notification" in window && !state.notificationPermissionRequested && Notification.permission === "default") {
    state.notificationPermissionRequested = true;
    Notification.requestPermission().catch(() => {});
  }
  socket.emit("chatMessage", { roomId: state.roomId, message });
  refs.chatInput.value = "";
});

refs.resignBtn.addEventListener("click", () => {
  openModal({
    title: "Сдаться",
    text: "Точно хотите сдаться?",
    actions: [
      { label: "Отмена" },
      { label: "Да, сдаться", className: "danger", onClick: () => socket.emit("resign", { roomId: state.roomId }) }
    ]
  });
});

refs.offerDrawBtn.addEventListener("click", () => {
  socket.emit("offerDraw", { roomId: state.roomId });
  showToast("Предложение ничьей отправлено");
});

refs.newGameBtn.addEventListener("click", () => {
  window.location.reload();
});

refs.leaveBtn.addEventListener("click", () => {
  window.location.reload();
});

document.querySelectorAll(".tab-btn").forEach((button) => {
  button.addEventListener("click", () => {
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    document.querySelectorAll(".tab-btn").forEach((it) => it.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((it) => {
      it.classList.remove("active");
      it.classList.remove("mobile-open");
    });
    button.classList.add("active");
    const selectedTab = document.getElementById(`${button.dataset.tab}Tab`);
    selectedTab.classList.add("active");
    if (isMobile) selectedTab.classList.add("mobile-open");

    state.chatOpen = button.dataset.tab === "chat";
    if (state.chatOpen) {
      state.unreadMessages = 0;
      updateChatBadge();
    }
  });
});

document.querySelectorAll(".tab-close").forEach((closeBtn) => {
  closeBtn.addEventListener("click", () => {
    const tab = closeBtn.closest(".tab-content");
    if (!tab) return;
    tab.classList.remove("mobile-open");
    tab.classList.remove("active");
    document.querySelectorAll(".tab-btn").forEach((it) => it.classList.remove("active"));
    state.chatOpen = false;
  });
});

socket.on("roomCreated", ({ roomId, color, difficulty }) => {
  state.roomId = roomId;
  state.myColor = color;
  state.difficulty = difficulty;
  state.gameStarted = false;
  refs.opponentStatus.textContent = "ожидание";
  refs.copyLinkBtn.classList.remove("hidden");
  enterGameScreen();
  showToast(`Комната ${roomId} создана`);
});

socket.on("roomJoined", ({ roomId, color, fen, difficulty }) => {
  state.roomId = roomId;
  state.myColor = color;
  state.difficulty = difficulty;
  state.gameStarted = true;
  refs.opponentStatus.textContent = "онлайн";
  chess.load(fen);
  enterGameScreen();
  scheduleNormalHints();
  showToast("Подключение к игре успешно");
});

socket.on("gameStart", ({ fen, difficulty }) => {
  state.gameStarted = true;
  state.difficulty = difficulty || state.difficulty;
  refs.opponentStatus.textContent = "онлайн";
  refs.difficultyLabel.textContent = getDifficultyLabel(state.difficulty);
  chess.load(fen);
  renderBoard();
  scheduleNormalHints();
  showToast("Игра началась");
});

socket.on("moveMade", ({ fen, move, history }) => {
  chess.load(fen);
  state.lastMove = { from: move.from, to: move.to };
  clearSelection();
  renderBoard();
  renderHistory(history);
  updateTurnUi();
  scheduleNormalHints();
  vibrateMove();
});

socket.on("timerUpdate", (payload) => {
  updateTimers(payload);
  updateTurnUi();
});

socket.on("chatMessage", (payload) => {
  appendChat(payload);
  const activeTab = document.querySelector(".tab-btn.active");
  state.chatOpen = activeTab?.dataset.tab === "chat";
  if (!state.chatOpen) {
    state.unreadMessages += 1;
    updateChatBadge();
    playNotificationSound();
    if (document.hidden && "Notification" in window && Notification.permission === "granted") {
      new Notification("Новое сообщение", { body: payload.message });
    }
  }
});

socket.on("drawOffered", () => {
  openModal({
    title: "Ничья",
    text: "Соперник предложил ничью",
    actions: [
      { label: "Отклонить", onClick: () => socket.emit("declineDraw", { roomId: state.roomId }) },
      { label: "Принять", onClick: () => socket.emit("acceptDraw", { roomId: state.roomId }) }
    ]
  });
});

socket.on("gameOver", ({ result, reason }) => {
  state.gameOver = true;
  clearTimeout(state.hintTimer);
  let title = "Игра завершена";
  if (result === "draw") title = "🤝 Ничья";
  if (result === state.myColor) title = "🏆 Победа!";
  if (result !== "draw" && result !== state.myColor) title = "Поражение";

  openModal({
    title,
    text: `Причина: ${reason}`,
    actions: [{ label: "Ок" }]
  });
});

socket.on("opponentLeft", () => {
  showToast("Соперник отключился. Комната закрыта.");
  setTimeout(resetToMenu, 600);
});

socket.on("invalidMove", () => {
  showToast("Некорректный ход");
});

socket.on("errorMsg", (message) => {
  showToast(message);
});

(() => {
  document.title = DEFAULT_TITLE;
  state.chatOpen = false;
  updateChatBadge();

  // Quick startup check to catch missing SVG assets early.
  PIECE_ASSETS.forEach((name) => {
    fetch(`/pieces/${name}.svg`, { method: "HEAD" }).then((response) => {
      if (!response.ok) {
        console.error(`Missing piece asset: /pieces/${name}.svg`);
      }
    });
  });

  const roomParam = new URLSearchParams(window.location.search).get("room");
  if (roomParam) {
    refs.roomCodeInput.value = roomParam.toUpperCase();
    socket.emit("joinRoom", roomParam.toUpperCase());
  }
})();
