/* client/script.js */
const socket = io(); // socket.io client
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const nameInput = document.getElementById('nameInput');
const sendBtn = document.getElementById('sendBtn');
const shareBtn = document.getElementById('shareBtn');
const typingEl = document.getElementById('typing');
const localVideo = document.getElementById('localVideo');
const installBtn = document.getElementById('installBtn');
const replyBox = document.getElementById('replyBox');
const replyPreview = document.getElementById('replyPreview');
const cancelReplyBtn = document.getElementById('cancelReply');

let username = localStorage.getItem('chat_name') || '';
if (!username) {
  nameInput.value = '';
} else {
  nameInput.value = username;
}
nameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    username = nameInput.value.trim() || username;
    localStorage.setItem('chat_name', username);
    nameInput.blur();
    socket.emit('register', username);
  }
});
nameInput.addEventListener('blur', () => {
  username = nameInput.value.trim() || username;
  if (username) localStorage.setItem('chat_name', username);
  socket.emit('register', username);
});

// helper uid
const uid = () => Math.random().toString(36).slice(2,9);

// Emoji map
const EMOJI = {':smile:':'😄',':heart:':'❤️',':thumbsup:':'👍',':fire:':'🔥',':laugh:':'😂',':sad:':'😢'};

function emojify(text){
  return text.replace(/:\w+:/g, (m) => EMOJI[m] || m);
}

// UI helpers
function showTyping(text){
  typingEl.textContent = text;
}

function appendMessage(msgObj, side = 'friend'){
  // msgObj: {id, sender, text, time, replyTo}
  const el = document.createElement('div');
  el.className = 'msg ' + (side === 'me' ? 'me' : 'friend');
  el.dataset.id = msgObj.id;
  const replyHtml = msgObj.replyTo ? `<div class="meta"><em>reply: ${escapeHtml(msgObj.replyTo.text)}</em></div>` : '';
  el.innerHTML = `
    ${replyHtml}
    <div class="meta"><strong>${escapeHtml(msgObj.sender)}</strong> <small>${msgObj.time}</small></div>
    <div class="text">${emojify(escapeHtml(msgObj.text))} <span class="ticks" id="tick-${msgObj.id}">${msgObj.ticks || ''}</span></div>
  `;
  // clicking on friend message opens reply preview and sends seen ack
  el.addEventListener('click', () => {
    if (side === 'friend') {
      // send seen ack to original sender
      if (msgObj.senderSocket) socket.emit('seen', { to: msgObj.senderSocket, id: msgObj.id });
      // prepare reply
      replyBox.classList.remove('hidden');
      replyPreview.textContent = `${msgObj.sender}: ${msgObj.text.slice(0,80)}`;
      replyBox.dataset.replyId = msgObj.id;
    }
  });
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

// send message
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  } else {
    // typing indicator
    socket.emit('typing', { sender: username || 'Anonymous' });
  }
});

function sendMessage(){
  if (!username) {
    alert('Please enter your name (top-left) and press Enter.');
    nameInput.focus();
    return;
  }
  const text = messageInput.value.trim();
  if (!text) return;
  const id = uid();
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const msgObj = {
    id, sender: username, senderSocket: socket.id, text, time,
    replyTo: replyBox.dataset.replyId ? { id: replyBox.dataset.replyId, text: replyPreview.textContent } : null,
    ticks: '✓'
  };
  // append locally as me
  appendMessage(msgObj, 'me');
  // clear reply UI
  replyBox.classList.add('hidden');
  replyPreview.textContent = '';
  replyBox.dataset.replyId = '';
  // send to server
  socket.emit('chat-message', msgObj);
  messageInput.value = '';
  socket.emit('stop-typing', { sender: username });
}

// cancel reply
cancelReplyBtn.addEventListener('click', () => {
  replyBox.classList.add('hidden');
  replyPreview.textContent = '';
  replyBox.dataset.replyId = '';
});

// Socket events
socket.on('connect', () => {
  username = username || `User${Math.floor(Math.random()*1000)}`;
  if (username) socket.emit('register', username);
});

// show incoming message (from others)
socket.on('chat-message', (msg) => {
  // msg: {id,sender,senderSocket,text,time,replyTo}
  // store original sender socket so we can send seen/delivered ack
  msg.senderSocket = msg.senderSocket || msg.senderSocket;
  appendMessage(msg, 'friend');
  // emit delivered ack to sender
  if (msg.senderSocket) socket.emit('delivered', { to: msg.senderSocket, id: msg.id });
});

// delivered ack: someone received your message
socket.on('delivered', ({ id }) => {
  const el = document.getElementById(`tick-${id}`);
  if (el) el.textContent = '✓✓';
});

// seen ack: someone marked seen
socket.on('seen', ({ id }) => {
  const el = document.getElementById(`tick-${id}`);
  if (el) el.textContent = '✓✓ (seen)';
});

// typing events
socket.on('typing', ({ sender }) => {
  if (sender !== username) showTyping(`${sender} is typing...`);
});
socket.on('stop-typing', ({ sender }) => {
  if (sender !== username) showTyping('');
});

// --- WebRTC Screen Share (simple signaling) ---
const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null;

shareBtn.addEventListener('click', startScreenShare);

async function startScreenShare(){
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    localVideo.srcObject = stream;
    localVideo.classList.remove('hidden');

    pc = new RTCPeerConnection(pcConfig);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate });
    };

    // create offer and send
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { offer, from: socket.id, sender: username });
  } catch (err) {
    console.error('Screen share error', err);
    alert('Screen share failed: ' + (err.message || err));
  }
}

// Someone sent an offer (viewer side) -> create answer
socket.on('webrtc-offer', async ({ offer, from }) => {
  try {
    const _pc = new RTCPeerConnection(pcConfig);
    _pc.ontrack = (e) => {
      localVideo.srcObject = e.streams[0];
      localVideo.classList.remove('hidden');
    };
    _pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate, to: from });
    };
    await _pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await _pc.createAnswer();
    await _pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { answer, to: from });
  } catch (err) { console.error(err); }
});

socket.on('webrtc-answer', async ({ answer }) => {
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('webrtc-candidate', async ({ candidate }) => {
  try { if (candidate && pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){console.error(e)}
});

// PWA install btn
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-block';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = 'none';
});
