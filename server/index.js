// server/index.js
const express = require('express');
const path = require('path');
const http = require('http');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors:{ origin: '*' } });

const PORT = process.env.PORT || 3000;

/* Serve client static files */
app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('/', (req,res) => res.sendFile(path.join(__dirname, '..', 'client', 'index.html')));

/* Socket.IO events */
io.on('connection', (socket) => {
  console.log('Socket connected', socket.id);

  socket.on('register', (username) => {
    socket.username = username;
    console.log('Registered', socket.id, username);
  });

  // chat-message from client -> broadcast to others (no echo)
  socket.on('chat-message', (msg) => {
    socket.broadcast.emit('chat-message', msg);
  });

  // delivered/seen acks - forward to target socket id
  socket.on('delivered', ({ to, id }) => {
    if (to) io.to(to).emit('delivered', { id });
  });

  socket.on('seen', ({ to, id }) => {
    if (to) io.to(to).emit('seen', { id });
  });

  // typing events
  socket.on('typing', (payload) => socket.broadcast.emit('typing', payload));
  socket.on('stop-typing', (payload) => socket.broadcast.emit('stop-typing', payload));

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => socket.broadcast.emit('webrtc-offer', data));
  socket.on('webrtc-answer', (data) => {
    if (data.to) io.to(data.to).emit('webrtc-answer', data);
    else socket.broadcast.emit('webrtc-answer', data);
  });
  socket.on('webrtc-candidate', (data) => {
    if (data.to) io.to(data.to).emit('webrtc-candidate', data);
    else socket.broadcast.emit('webrtc-candidate', data);
  });

  socket.on('disconnect', () => console.log('Socket disconnected', socket.id));
});

server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
