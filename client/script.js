const socket = io();
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const typingIndicator = document.getElementById('typing-indicator');

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keypress', () => {
  socket.emit('typing');
});

function sendMessage() {
  const msg = input.value.trim();
  if (msg) {
    addMessage('You', msg, true);
    socket.emit('chat message', msg);
    input.value = '';
  }
}

socket.on('chat message', (data) => {
  addMessage('Friend', data, false);
});

socket.on('typing', () => {
  typingIndicator.style.display = 'block';
  setTimeout(() => typingIndicator.style.display = 'none', 2000);
});

function addMessage(sender, text, isMine) {
  const div = document.createElement('div');
  div.classList.add('message');
  div.classList.add(isMine ? 'my-message' : 'friend-message');
  div.innerHTML = `<strong>${sender}:</strong> ${text} ${isMine ? '<span class="tick">✓✓</span>' : ''}`;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
