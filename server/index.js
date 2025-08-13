// server/index.js
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

// serve static client folder
app.use(express.static(path.join(__dirname, '../client')));
app.get('/', (req,res) => res.sendFile(path.join(__dirname, '../client/index.html')));

// simple in-memory presence
const users = {}; // socketId -> name

io.on('connection', (socket) => {
  console.log('connected', socket.id);

  socket.on('user:join', (name) => {
    users[socket.id] = name;
    io.emit('presence:list', Object.values(users));
  });

  socket.on('presence:request', () => {
    socket.emit('presence:list', Object.values(users));
  });

  socket.on('chat:send', (payload) => {
    // payload { id, text, from, ts, replyTo }
    socket.emit('chat:status', { id: payload.id, status: 'sent' });
    // broadcast to others
    socket.broadcast.emit('chat:new', payload);
    // ack delivered
    socket.emit('chat:status', { id: payload.id, status: 'delivered' });
  });

  socket.on('chat:seen', ({ id, from }) => {
    // find sender socket by name
    const senderSocket = Object.keys(users).find(k => users[k] === from);
    if (senderSocket) {
      io.to(senderSocket).emit('chat:status', { id, status: 'seen' });
    }
  });

  socket.on('chat:typing', ({ from, isTyping }) => {
    socket.broadcast.emit('chat:typing', { from, isTyping });
  });

  socket.on('screen:start', ({ by }) => {
    socket.broadcast.emit('screen:start', { by });
  });
  socket.on('screen:stop', () => {
    socket.broadcast.emit('screen:stop');
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.emit('presence:list', Object.values(users));
    console.log('disconnected', socket.id);
  });
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
