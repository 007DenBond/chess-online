# ♟️ BondChess

Современные онлайн-шахматы для 2 игроков с комнатами, чатом, таймерами и адаптацией под мобильные устройства.

## Возможности

- Комнаты по 6-значному коду и вход по ссылке `?room=XXXXXX`
- Реалтайм-игра через Socket.IO
- Полные правила шахмат через `chess.js`
- Чат, история ходов, таймеры
- Режим сложности подсказок:
  - `easy` - подсказки сразу
  - `normal` - подсказки через 30 сек хода
  - `hard` - без подсказок

## Стек

- Node.js + Express
- Socket.IO
- chess.js
- HTML/CSS/Vanilla JS

## Быстрый старт

```bash
npm install
npm start
```

Откройте [http://localhost:3000](http://localhost:3000).

## Деплой (Render)

1. Создать новый Web Service из GitHub-репозитория
2. Build Command: `npm install`
3. Start Command: `npm start`
4. Environment: Node 18+

## Автор

Made with ❤️ by DenBOND
