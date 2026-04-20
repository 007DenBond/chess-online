const socket = io();
const ChessCtor = window.Chess;

if (typeof ChessCtor === "undefined") {
  throw new Error("Chess is not defined");
}

const chess = new ChessCtor();
const NORMAL_HINT_DELAY_MS = 10000;
const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const PIECE_TYPES = { p: "P", n: "N", b: "B", r: "R", q: "Q", k: "K" };
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
  waitingForOpponent: false,
  timers: { white: 600, black: 600 },
  localTimerInterval: null,
  unreadMessages: 0,
  chatOpen: false
};

const refs = {
  menuScreen: document.getElementById("menuScreen"),
  gameScreen: document.getElementById("gameScreen"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  difficultySelect: document.getElementById("difficultySelect"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  board: document.getElementById("board"),
  turnLabel: document.getElementById("turnLabel"),
  roomCodeTopBtn: document.getElementById("roomCodeTopBtn"),
  roomCodeTopValue: document.getElementById("roomCodeTopValue"),
  roomCodeTopIcon: document.getElementById("roomCodeTopIcon"),
  waitingBanner: document.getElementById("waitingBanner"),
  waitingCodeValue: document.getElementById("waitingCodeValue"),
  copyWaitingCodeBtn: document.getElementById("copyWaitingCodeBtn"),
  whitePlayerName: document.getElementById("whitePlayerName"),
  blackPlayerName: document.getElementById("blackPlayerName"),
  historyList: document.getElementById("historyList"),
  chatMessages: document.getElementById("chatMessages"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  blackTimer: document.getElementById("blackTimer"),
  whiteTimer: document.getElementById("whiteTimer"),
  resignBtn: document.getElementById("resignBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  openChatBtn: document.getElementById("openChatBtn"),
  openHistoryBtn: document.getElementById("openHistoryBtn"),
  chatModal: document.getElementById("chatModal"),
  historyModal: document.getElementById("historyModal"),
  roomCodeLabel: document.getElementById("roomCodeLabel"),
  myColorLabel: document.getElementById("myColorLabel"),
  opponentStatus: document.getElementById("opponentStatus"),
  difficultyLabel: document.getElementById("difficultyLabel"),
  toast: document.getElementById("toast"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalText: document.getElementById("modalText"),
  modalActions: document.getElementById("modalActions")
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
  showToast.timer = setTimeout(() => refs.toast.classList.add("hidden"), 2200);
};

const fallbackCopyText = (text) => {
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();
  try {
    document.execCommand("copy");
  } finally {
    input.remove();
  }
};

const copyRoomCodeWithFeedback = async (target = "top") => {
  const code = state.roomId;
  if (!code) return;
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(code);
    else fallbackCopyText(code);
  } catch (_e) {
    fallbackCopyText(code);
  }

  if (target === "top") {
    const original = refs.roomCodeTopIcon.textContent;
    refs.roomCodeTopIcon.textContent = "✓ Скопировано";
    setTimeout(() => {
      refs.roomCodeTopIcon.textContent = original;
    }, 1500);
  } else {
    const original = refs.copyWaitingCodeBtn.textContent;
    refs.copyWaitingCodeBtn.textContent = "✓ Скопировано";
    setTimeout(() => {
      refs.copyWaitingCodeBtn.textContent = original;
    }, 1500);
  }
};

const openConfirmModal = ({ title, text, onConfirm }) => {
  refs.modalTitle.textContent = title;
  refs.modalText.textContent = text;
  refs.modalActions.innerHTML = "";
  const cancel = document.createElement("button");
  cancel.textContent = "Отмена";
  cancel.addEventListener("click", () => refs.modal.classList.add("hidden"));
  const confirm = document.createElement("button");
  confirm.textContent = "Да";
  confirm.className = "primary";
  confirm.addEventListener("click", () => {
    refs.modal.classList.add("hidden");
    onConfirm();
  });
  refs.modalActions.append(cancel, confirm);
  refs.modal.classList.remove("hidden");
};

const toSquare = (row, col, forBlack) => {
  const fileIndex = forBlack ? 7 - col : col;
  const rank = forBlack ? row + 1 : 8 - row;
  return `${FILES[fileIndex]}${rank}`;
};

const formatTimer = (seconds) => {
  const value = Math.max(0, seconds);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
};

const stopLocalTimer = () => {
  if (state.localTimerInterval) {
    clearInterval(state.localTimerInterval);
    state.localTimerInterval = null;
  }
};

const isInCheck = () => {
  if (typeof chess.inCheck === "function") return chess.inCheck();
  if (typeof chess.in_check === "function") return chess.in_check();
  return false;
};

const updateStatusText = () => {
  const turn = chess.turn() === "w" ? "белых" : "чёрных";
  if (state.gameOver) return;
  refs.turnLabel.textContent = isInCheck() ? `Шах! Ход ${turn}` : `Ход ${turn}`;
};

const updateTopPlayers = () => {
  refs.whitePlayerName.textContent = state.myColor === "white" ? "Белые (Вы)" : "Белые";
  refs.blackPlayerName.textContent = state.myColor === "black" ? "Чёрные (Вы)" : "Чёрные";
};

const applyTimerUiState = () => {
  const activeColor = chess.turn() === "w" ? "white" : "black";
  refs.whiteTimer.classList.toggle("active", activeColor === "white");
  refs.blackTimer.classList.toggle("active", activeColor === "black");
  refs.whiteTimer.classList.toggle("low-time", state.timers.white <= 30);
  refs.blackTimer.classList.toggle("low-time", state.timers.black <= 30);
};

const renderTimers = () => {
  refs.whiteTimer.textContent = formatTimer(state.timers.white);
  refs.blackTimer.textContent = formatTimer(state.timers.black);
  applyTimerUiState();
};

const startLocalTimer = () => {
  stopLocalTimer();
  state.localTimerInterval = setInterval(() => {
    if (!state.gameStarted || state.gameOver || state.waitingForOpponent) return;
    const activeColor = chess.turn() === "w" ? "white" : "black";
    state.timers[activeColor] = Math.max(0, state.timers[activeColor] - 1);
    renderTimers();
  }, 1000);
};

const updateRoomCodeUi = () => {
  const code = state.roomId || "------";
  refs.roomCodeTopValue.textContent = code;
  refs.waitingCodeValue.textContent = code;
};

const updateWaitingBanner = () => {
  refs.waitingBanner.classList.toggle("hidden", !state.waitingForOpponent);
};

const updateChatBadge = () => {
  let badge = refs.openChatBtn.querySelector(".badge");
  if (state.unreadMessages > 0) {
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "badge";
      refs.openChatBtn.appendChild(badge);
    }
    badge.textContent = state.unreadMessages > 9 ? "9+" : String(state.unreadMessages);
  } else if (badge) {
    badge.remove();
  }
  document.title = state.unreadMessages > 0 ? `(${state.unreadMessages}) ${DEFAULT_TITLE}` : DEFAULT_TITLE;
};

const scheduleNormalHints = () => {
  clearTimeout(state.hintTimer);
  state.hintUnlocked = state.difficulty !== "normal";
  const myTurn = (chess.turn() === "w" ? "white" : "black") === state.myColor;
  if (state.difficulty === "normal" && myTurn && !state.gameOver) {
    state.hintTimer = setTimeout(() => {
      state.hintUnlocked = true;
      renderBoard();
      showToast("Подсказки активированы");
    }, NORMAL_HINT_DELAY_MS);
  }
};

const canShowHints = () => {
  if (state.difficulty === "hard") return false;
  if (state.difficulty === "normal") return state.hintUnlocked;
  return true;
};

const showMovesForSquare = (square) => {
  state.selectedSquare = square;
  state.legalMoves = chess.moves({ square, verbose: true });
};

const clearSelection = () => {
  state.selectedSquare = null;
  state.legalMoves = [];
};

const renderHistory = (history) => {
  refs.historyList.innerHTML = "";
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement("li");
    const moveNumber = Math.floor(i / 2) + 1;
    const white = history[i] || "";
    const black = history[i + 1] || "";
    li.textContent = `${moveNumber}. ${white}${black ? `    ${black}` : ""}`;
    refs.historyList.appendChild(li);
  }
};

const renderBoard = () => {
  refs.board.innerHTML = "";
  const forBlack = state.myColor === "black";
  const boardData = chess.board();
  const showHints = canShowHints();

  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const square = toSquare(row, col, forBlack);
      const file = square.charCodeAt(0) - 97;
      const rank = Number(square[1]) - 1;
      const piece = boardData[7 - rank][file];

      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `square ${(row + col) % 2 === 0 ? "light" : "dark"}`;
      cell.dataset.square = square;
      if (piece) {
        const p = document.createElement("div");
        p.className = "piece";
        p.style.backgroundImage = `url('/pieces/${piece.color}${PIECE_TYPES[piece.type]}.svg')`;
        cell.appendChild(p);
      }

      if (state.selectedSquare === square) cell.classList.add("selected");
      if (state.lastMove && (state.lastMove.from === square || state.lastMove.to === square)) cell.classList.add("last-move");

      if (showHints && state.selectedSquare) {
        const move = state.legalMoves.find((m) => m.to === square);
        if (move) {
          const capture = Boolean(move.captured) || String(move.flags || "").includes("c") || String(move.flags || "").includes("e");
          cell.classList.add(capture ? "hint-capture" : "hint-dot");
        }
      }

      const checkColor = chess.turn() === "w" ? "w" : "b";
      if (piece?.type === "k" && piece.color === checkColor && isInCheck()) cell.classList.add("in-check");

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

      cell.addEventListener("click", () => onCellSelect(square));
      cell.addEventListener(
        "touchend",
        (event) => {
          event.preventDefault();
          onCellSelect(square);
        },
        { passive: false }
      );
      // РЕГРЕССИЯ: не ломать одиночный клик! Ход делается в 2 тапа: фигура -> клетка

      refs.board.appendChild(cell);
    }
  }
};

const emitMove = ({ from, to, promotion }) => {
  socket.emit("move", { roomId: state.roomId, from, to, promotion });
};

const requestPromotion = (callback) => {
  openConfirmModal({
    title: "Превращение пешки",
    text: "Выбрать ферзя?",
    onConfirm: () => callback("q")
  });
};

const tryMove = (from, to) => {
  const piece = chess.get(from);
  if (!piece) return;
  const promo = piece.type === "p" && ((piece.color === "w" && to[1] === "8") || (piece.color === "b" && to[1] === "1"));
  if (promo) return requestPromotion((promotion) => emitMove({ from, to, promotion }));
  emitMove({ from, to });
};

const onCellSelect = (square) => {
  if (!state.gameStarted || state.gameOver) return;
  const myTurn = (chess.turn() === "w" ? "white" : "black") === state.myColor;
  if (!myTurn) return;

  const piece = chess.get(square);
  const myPieceColor = state.myColor === "white" ? "w" : "b";

  if (state.selectedSquare && state.selectedSquare !== square) {
    const legal = state.legalMoves.some((m) => m.to === square);
    if (legal || !piece || piece.color !== myPieceColor) {
      const from = state.selectedSquare;
      clearSelection();
      renderBoard();
      return tryMove(from, square);
    }
  }

  if (!piece || piece.color !== myPieceColor) {
    clearSelection();
    return renderBoard();
  }

  showMovesForSquare(square);
  renderBoard();
};

const updateTimers = ({ white, black }) => {
  state.timers.white = white;
  state.timers.black = black;
  renderTimers();
};

const openOverlay = (name) => {
  const target = name === "chat" ? refs.chatModal : refs.historyModal;
  target.classList.remove("hidden");
  if (name === "chat") {
    state.chatOpen = true;
    state.unreadMessages = 0;
    updateChatBadge();
    refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
    refs.chatInput.focus();
  }
};

const closeOverlay = (name) => {
  const target = name === "chat" ? refs.chatModal : refs.historyModal;
  target.classList.add("hidden");
  if (name === "chat") state.chatOpen = false;
};

const enterGameScreen = () => {
  refs.menuScreen.classList.add("hidden");
  refs.gameScreen.classList.remove("hidden");
  refs.roomCodeLabel.textContent = state.roomId;
  refs.myColorLabel.textContent = state.myColor || "";
  updateRoomCodeUi();
  updateTopPlayers();
  updateWaitingBanner();
  updateStatusText();
  renderTimers();
  renderBoard();
};

const resetToMenu = () => {
  clearSelection();
  chess.reset();
  state.roomId = "";
  state.myColor = null;
  state.gameStarted = false;
  state.gameOver = false;
  state.lastMove = null;
  state.timers.white = 600;
  state.timers.black = 600;
  state.unreadMessages = 0;
  state.chatOpen = false;
  state.waitingForOpponent = false;
  stopLocalTimer();
  clearTimeout(state.hintTimer);
  refs.menuScreen.classList.remove("hidden");
  refs.gameScreen.classList.add("hidden");
  refs.copyLinkBtn.classList.add("hidden");
  refs.chatMessages.innerHTML = "";
  refs.historyList.innerHTML = "";
  closeOverlay("chat");
  closeOverlay("history");
  updateChatBadge();
};

const appendChat = ({ color, message }) => {
  const row = document.createElement("div");
  row.className = "chat-line";
  row.innerHTML = `<b>${color === "white" ? "⚪" : "⚫"}</b> ${sanitizeText(message)}`;
  refs.chatMessages.appendChild(row);
  refs.chatMessages.scrollTop = refs.chatMessages.scrollHeight;
};

const bindTap = (element, handler) => {
  if (!element) return;
  element.addEventListener("click", handler);
  element.addEventListener(
    "touchend",
    (event) => {
      event.preventDefault();
      handler();
    },
    { passive: false }
  );
};

bindTap(refs.createRoomBtn, () => {
  if (!socket.connected) {
    showToast("Нет соединения с сервером");
    return;
  }
  const difficulty = refs.difficultySelect?.value ?? "normal";
  socket.emit("createRoom", { difficulty });
});

bindTap(refs.joinRoomBtn, () => {
  if (!socket.connected) {
    showToast("Нет соединения с сервером");
    return;
  }
  const roomId = refs.roomCodeInput.value.trim().toUpperCase();
  if (roomId.length !== 6) return showToast("Введите 6-значный код комнаты");
  socket.emit("joinRoom", roomId);
});

refs.copyLinkBtn.addEventListener("click", async () => {
  await navigator.clipboard.writeText(`${window.location.origin}/?room=${state.roomId}`);
  showToast("Ссылка скопирована");
});

refs.roomCodeTopBtn.addEventListener("click", () => {
  copyRoomCodeWithFeedback("top");
});

refs.copyWaitingCodeBtn.addEventListener("click", () => {
  copyRoomCodeWithFeedback("waiting");
});

refs.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = refs.chatInput.value.trim();
  if (!message) return;
  socket.emit("chatMessage", { roomId: state.roomId, message });
  refs.chatInput.value = "";
});

refs.openChatBtn.addEventListener("click", () => openOverlay("chat"));
refs.openHistoryBtn.addEventListener("click", () => openOverlay("history"));

refs.resignBtn.addEventListener("click", () =>
  openConfirmModal({
    title: "Сдаться",
    text: "Точно сдаться?",
    onConfirm: () => socket.emit("resign", { roomId: state.roomId })
  })
);

refs.leaveBtn.addEventListener("click", () =>
  openConfirmModal({
    title: "Выйти из игры",
    text: "Вернуться в лобби?",
    onConfirm: () => window.location.reload()
  })
);

document.querySelectorAll("[data-close-modal]").forEach((el) =>
  el.addEventListener("click", () => closeOverlay(el.dataset.closeModal))
);

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeOverlay("chat");
  closeOverlay("history");
});

socket.on("roomCreated", ({ roomId, color, difficulty }) => {
  state.roomId = roomId;
  state.myColor = color;
  state.difficulty = difficulty;
  state.gameStarted = false;
  state.waitingForOpponent = true;
  state.timers.white = 600;
  state.timers.black = 600;
  stopLocalTimer();
  refs.copyLinkBtn.classList.remove("hidden");
  enterGameScreen();
  showToast(`Комната ${roomId} создана`);
});

socket.on("roomJoined", ({ roomId, color, fen, difficulty }) => {
  state.roomId = roomId;
  state.myColor = color;
  state.difficulty = difficulty;
  state.gameStarted = true;
  state.waitingForOpponent = false;
  chess.load(fen);
  enterGameScreen();
  startLocalTimer();
  scheduleNormalHints();
  showToast("Подключение успешно");
});

socket.on("gameStart", ({ fen, difficulty }) => {
  state.gameStarted = true;
  state.difficulty = difficulty || state.difficulty;
  state.waitingForOpponent = false;
  chess.load(fen);
  updateWaitingBanner();
  startLocalTimer();
  renderBoard();
  updateStatusText();
  scheduleNormalHints();
});

socket.on("moveMade", ({ fen, move, history }) => {
  chess.load(fen);
  state.lastMove = { from: move.from, to: move.to };
  clearSelection();
  renderBoard();
  renderHistory(history);
  updateStatusText();
  applyTimerUiState();
  scheduleNormalHints();
});

socket.on("timerUpdate", (payload) => updateTimers(payload));

socket.on("chatMessage", (payload) => {
  appendChat(payload);
  if (!state.chatOpen) {
    state.unreadMessages += 1;
    updateChatBadge();
  }
});

socket.on("drawOffered", () => showToast("Соперник предложил ничью"));

socket.on("gameOver", ({ result, reason }) => {
  state.gameOver = true;
  stopLocalTimer();
  clearTimeout(state.hintTimer);
  if (result === "draw") refs.turnLabel.textContent = "Ничья";
  else refs.turnLabel.textContent = result === state.myColor ? "Мат. Победа!" : "Мат. Поражение";
  openConfirmModal({ title: "Игра завершена", text: `Причина: ${reason}`, onConfirm: () => {} });
});

socket.on("opponentLeft", () => {
  stopLocalTimer();
  showToast("Соперник отключился");
  setTimeout(resetToMenu, 500);
});

socket.on("invalidMove", () => showToast("Некорректный ход"));
socket.on("errorMsg", (message) => showToast(message));

document.title = DEFAULT_TITLE;
updateChatBadge();

const roomParam = new URLSearchParams(window.location.search).get("room");
if (roomParam) {
  refs.roomCodeInput.value = roomParam.toUpperCase();
  socket.emit("joinRoom", roomParam.toUpperCase());
}
