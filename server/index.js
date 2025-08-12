// server/index.js
const express = require('express');
const path = require('path');
const http = require('http');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('register', (username) => {
    socket.username = username;
  });

  socket.on('chat-message', (msg) => {
    // broadcast to all others (no echo)
    socket.broadcast.emit('chat-message', msg);
  });

  // delivered/seen acks
  socket.on('delivered', ({ to, id }) => {
    if (to) io.to(to).emit('delivered', { id, fromSocket: socket.id });
  });
  socket.on('seen', ({ to, id }) => {
    if (to) io.to(to).emit('seen', { id, fromSocket: socket.id });
  });

  // typing
  socket.on('typing', (payload) => {
    socket.broadcast.emit('typing', payload);
  });
  socket.on('stop-typing', (payload) => {
    socket.broadcast.emit('stop-typing', payload);
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    // broadcast offer
    socket.broadcast.emit('webrtc-offer', data);
  });
  socket.on('webrtc-answer', (data) => {
    if (data.to) io.to(data.to).emit('webrtc-answer', data);
    else socket.broadcast.emit('webrtc-answer', data);
  });
  socket.on('webrtc-candidate', (data) => {
    if (data.to) io.to(data.to).emit('webrtc-candidate', data);
    else socket.broadcast.emit('webrtc-candidate', data);
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
