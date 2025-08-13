const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// Serve client
app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/health', (req, res) => res.json({ ok: true }));

// In-memory presence & delivery tracking (simple)
const users = new Map(); // socket.id -> {name}
const socketsByName = new Map(); // name -> socket.id (last one)
let broadcasterId = null; // socket.id of current screen broadcaster

io.on('connection', (socket) => {
  // Join with username
  socket.on('user:join', (name) => {
    users.set(socket.id, { name });
    socketsByName.set(name, socket.id);
    socket.join('global');

    // presence list
    const everyone = [...users.values()].map(u => u.name);
    io.to('global').emit('presence:update', everyone);
  });

  // Chat message (server never echoes back to sender)
  socket.on('chat:message', (payload) => {
    // payload: { id, text, from }
    socket.to('global').emit('chat:message', payload);
    // Acknowledge delivered to sender (double tick)
    socket.emit('chat:delivered', { id: payload.id });
  });

  // Typing indicator (broadcast to others)
  socket.on('chat:typing', ({ from, isTyping }) => {
    socket.to('global').emit('chat:typing', { from, isTyping });
  });

  // Seen receipts
  socket.on('chat:seen', ({ lastId, from }) => {
    socket.to('global').emit('chat:seen', { lastId, from });
  });

  /* ---------- WebRTC Screen Share Signaling ---------- */
  socket.on('screen:broadcast:start', () => {
    broadcasterId = socket.id;
    socket.to('global').emit('screen:broadcast:available', { by: users.get(socket.id)?.name || 'Unknown' });
  });

  socket.on('screen:broadcast:stop', () => {
    socket.to('global').emit('screen:broadcast:stopped');
    broadcasterId = null;
  });

  // Viewer announces they want to watch
  socket.on('screen:watcher', () => {
    if (broadcasterId) {
      io.to(broadcasterId).emit('screen:watcher', socket.id);
    }
  });

  // WebRTC pass-through signaling
  socket.on('screen:offer', (id, description) => {
    io.to(id).emit('screen:offer', socket.id, description);
  });

  socket.on('screen:answer', (id, description) => {
    io.to(id).emit('screen:answer', socket.id, description);
  });

  socket.on('screen:candidate', (id, candidate) => {
    io.to(id).emit('screen:candidate', socket.id, candidate);
  });

  socket.on('disconnect', () => {
    const left = users.get(socket.id)?.name;
    users.delete(socket.id);
    if (left) {
      // remove from reverse map if same socket
      if (socketsByName.get(left) === socket.id) socketsByName.delete(left);
    }
    if (socket.id === broadcasterId) {
      io.to('global').emit('screen:broadcast:stopped');
      broadcasterId = null;
    }
    const everyone = [...users.values()].map(u => u.name);
    io.to('global').emit('presence:update', everyone);
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
