// server/index.js
const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// serve client
app.use(express.static(path.join(__dirname, '..', 'client')));

// in-memory maps
const users = new Map();  // socket.id -> { name }
const socketsByName = new Map(); // name -> socket.id (last seen)

io.on('connection', (socket) => {
  const name = socket.handshake.query?.name?.toString().trim() || `User-${socket.id.slice(0,4)}`;
  users.set(socket.id, { name });
  socketsByName.set(name, socket.id);

  // notify others someone joined
  socket.broadcast.emit('presence:join', { name });

  // typing
  socket.on('chat:typing', (isTyping) => {
    socket.broadcast.emit('chat:typing', { name, isTyping });
  });

  // message send (no echo back to sender)
  socket.on('chat:send', (payload) => {
    // payload: { id, text, from, ts }
    // ack "sent" to the sender immediately
    socket.emit('chat:status', { id: payload.id, status: 'sent' });

    // deliver to everyone else
    socket.broadcast.emit('chat:new', payload);

    // let sender mark as delivered as soon as it was broadcast
    socket.emit('chat:status', { id: payload.id, status: 'delivered' });
  });

  // when a receiver renders message => notify sender to flip to "seen"
  socket.on('chat:seen', ({ id, from }) => {
    const senderSocketId = socketsByName.get(from);
    if (senderSocketId) {
      io.to(senderSocketId).emit('chat:status', { id, status: 'seen' });
    }
  });

  // WebRTC signaling for screen share
  socket.on('webrtc:offer', (data) => {
    socket.broadcast.emit('webrtc:offer', { from: name, sdp: data.sdp });
  });
  socket.on('webrtc:answer', (data) => {
    socket.broadcast.emit('webrtc:answer', { from: name, sdp: data.sdp });
  });
  socket.on('webrtc:ice', (candidate) => {
    socket.broadcast.emit('webrtc:ice', candidate);
  });

  socket.on('disconnect', () => {
    const u = users.get(socket.id);
    if (u) {
      socketsByName.delete(u.name);
      io.emit('presence:leave', { name: u.name });
    }
    users.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
