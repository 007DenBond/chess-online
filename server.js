const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Chess } = require("chess.js");

const PORT = process.env.PORT || 3000;
const ROOM_ID_LENGTH = 6;
const ROOM_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TIMER_SECONDS = 10 * 60;
const CHAT_MAX_LENGTH = 200;
const ALLOWED_DIFFICULTY = new Set(["easy", "normal", "hard"]);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = {};

const randomRoomId = () => {
  let roomId = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * ROOM_ID_ALPHABET.length);
    roomId += ROOM_ID_ALPHABET[index];
  }
  return roomId;
};

const createUniqueRoomId = () => {
  let roomId = randomRoomId();
  while (rooms[roomId]) {
    roomId = randomRoomId();
  }
  return roomId;
};

const getSocketColor = (room, socketId) => {
  if (room.players.white === socketId) return "white";
  if (room.players.black === socketId) return "black";
  return null;
};

const toTimerPayload = (room) => ({ white: room.timers.white, black: room.timers.black });

const getGameOverReason = (chess) => {
  if (chess.isCheckmate()) return "checkmate";
  if (chess.isStalemate()) return "stalemate";
  if (chess.isThreefoldRepetition()) return "threefold_repetition";
  if (chess.isInsufficientMaterial()) return "insufficient_material";
  if (chess.isDrawByFiftyMoves()) return "fifty_move_rule";
  if (chess.isDraw()) return "draw";
  return "game_over";
};

const stopRoomTimer = (room) => {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
};

const finishRoom = (roomId, payload) => {
  const room = rooms[roomId];
  if (!room || room.gameOver) return;

  room.gameOver = true;
  stopRoomTimer(room);
  io.to(roomId).emit("gameOver", payload);
};

const maybeStartTimer = (roomId) => {
  const room = rooms[roomId];
  if (!room || room.timerInterval || room.gameOver) return;
  if (!room.players.white || !room.players.black) return;

  room.timerInterval = setInterval(() => {
    const currentRoom = rooms[roomId];
    if (!currentRoom || currentRoom.gameOver) return;
    if (!currentRoom.players.white || !currentRoom.players.black) return;

    const turn = currentRoom.chess.turn() === "w" ? "white" : "black";
    currentRoom.timers[turn] -= 1;
    io.to(roomId).emit("timerUpdate", toTimerPayload(currentRoom));

    if (currentRoom.timers[turn] <= 0) {
      const winner = turn === "white" ? "black" : "white";
      finishRoom(roomId, { result: winner, reason: "time" });
    }
  }, 1000);
};

const sanitizeMessage = (value) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, CHAT_MAX_LENGTH);
};

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("createRoom", (payload = {}) => {
    try {
      const difficulty = ALLOWED_DIFFICULTY.has(payload.difficulty) ? payload.difficulty : "easy";
      const roomId = createUniqueRoomId();
      const chess = new Chess();

      rooms[roomId] = {
        chess,
        difficulty,
        players: { white: socket.id, black: null },
        timers: { white: TIMER_SECONDS, black: TIMER_SECONDS },
        timerInterval: null,
        gameOver: false,
        drawOfferFrom: null
      };

      socket.join(roomId);
      socket.emit("roomCreated", { roomId, color: "white", difficulty });
      console.log(`Room created: ${roomId} by ${socket.id}, difficulty=${difficulty}`);
    } catch (error) {
      console.error("createRoom error:", error);
      socket.emit("errorMsg", "Не удалось создать комнату.");
    }
  });

  socket.on("joinRoom", (roomIdRaw) => {
    try {
      const roomId = String(roomIdRaw || "").trim().toUpperCase();
      const room = rooms[roomId];
      if (!room) return socket.emit("errorMsg", "Комната не найдена.");
      if (room.gameOver) return socket.emit("errorMsg", "Партия уже завершена.");
      if (room.players.black && room.players.black !== socket.id) {
        return socket.emit("errorMsg", "Комната уже заполнена.");
      }

      room.players.black = socket.id;
      socket.join(roomId);

      socket.emit("roomJoined", {
        roomId,
        color: "black",
        fen: room.chess.fen(),
        difficulty: room.difficulty
      });

      io.to(room.players.white).emit("gameStart", {
        fen: room.chess.fen(),
        difficulty: room.difficulty
      });

      io.to(roomId).emit("timerUpdate", toTimerPayload(room));
      maybeStartTimer(roomId);
      console.log(`Room joined: ${roomId} by ${socket.id}`);
    } catch (error) {
      console.error("joinRoom error:", error);
      socket.emit("errorMsg", "Не удалось войти в комнату.");
    }
  });

  socket.on("move", ({ roomId, from, to, promotion }) => {
    try {
      const room = rooms[roomId];
      if (!room || room.gameOver) return;

      const color = getSocketColor(room, socket.id);
      if (!color) return;

      const expectedTurn = room.chess.turn() === "w" ? "white" : "black";
      if (expectedTurn !== color) {
        socket.emit("invalidMove");
        return;
      }

      const move = room.chess.move({ from, to, promotion: promotion || "q" });
      if (!move) {
        socket.emit("invalidMove");
        return;
      }

      room.drawOfferFrom = null;

      io.to(roomId).emit("moveMade", {
        fen: room.chess.fen(),
        move,
        turn: room.chess.turn() === "w" ? "white" : "black",
        history: room.chess.history()
      });

      if (room.chess.isGameOver()) {
        const reason = getGameOverReason(room.chess);
        const result = reason === "checkmate" ? color : "draw";
        finishRoom(roomId, { result, reason });
      }
    } catch (error) {
      console.error("move error:", error);
      socket.emit("invalidMove");
    }
  });

  socket.on("chatMessage", ({ roomId, message }) => {
    try {
      const room = rooms[roomId];
      if (!room) return;

      const color = getSocketColor(room, socket.id);
      if (!color) return;

      const clean = sanitizeMessage(message);
      if (!clean) return;

      io.to(roomId).emit("chatMessage", { color, message: clean });
    } catch (error) {
      console.error("chatMessage error:", error);
      socket.emit("errorMsg", "Сообщение не отправлено.");
    }
  });

  socket.on("resign", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver) return;

    const color = getSocketColor(room, socket.id);
    if (!color) return;

    const winner = color === "white" ? "black" : "white";
    finishRoom(roomId, { result: winner, reason: "resign" });
  });

  socket.on("offerDraw", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver) return;

    const color = getSocketColor(room, socket.id);
    if (!color) return;

    room.drawOfferFrom = color;
    socket.to(roomId).emit("drawOffered");
  });

  socket.on("acceptDraw", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver || !room.drawOfferFrom) return;
    finishRoom(roomId, { result: "draw", reason: "draw_agreed" });
  });

  socket.on("declineDraw", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || room.gameOver) return;
    room.drawOfferFrom = null;
    socket.to(roomId).emit("errorMsg", "Соперник отклонил ничью.");
  });

  socket.on("disconnect", () => {
    try {
      Object.entries(rooms).forEach(([roomId, room]) => {
        if (room.players.white !== socket.id && room.players.black !== socket.id) return;

        stopRoomTimer(room);
        io.to(roomId).emit("opponentLeft");
        delete rooms[roomId];
        console.log(`Room deleted: ${roomId}, disconnected ${socket.id}`);
      });
      console.log("Socket disconnected:", socket.id);
    } catch (error) {
      console.error("disconnect error:", error);
    }
  });
});

server.listen(PORT, () => {
  console.log(`BondChess server started on http://localhost:${PORT}`);
});
