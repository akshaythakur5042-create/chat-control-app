/* client/script.js
   Features: username, no-echo chat, typing, delivered/seen ticks, reply, WebRTC screen share signaling, PWA install button
*/
const socket = io(); // connects to same origin

/* DOM refs */
const messagesEl = document.getElementById('messages');
const nameInput = document.getElementById('nameInput');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const shareBtn = document.getElementById('shareBtn');
const typingEl = document.getElementById('typing');
const replyBox = document.getElementById('replyBox');
const replyText = document.getElementById('replyText');
const cancelReply = document.getElementById('cancelReply');
const installBtn = document.getElementById('installBtn');
const localVideo = document.getElementById('localVideo');

let username = localStorage.getItem('chat_name') || '';
if (username) nameInput.value = username;

nameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    username = nameInput.value.trim() || username || `User${Math.floor(Math.random()*1000)}`;
    localStorage.setItem('chat_name', username);
    socket.emit('register', username);
    nameInput.blur();
  }
});
nameInput.addEventListener('blur', () => {
  username = nameInput.value.trim() || username;
  if (username) {
    localStorage.setItem('chat_name', username);
    socket.emit('register', username);
  }
});

/* helper uid */
const uid = () => Math.random().toString(36).slice(2,9);

/* basic emoji map */
const EMOJI = {':smile:':'😄',':heart:':'❤️',':thumbsup:':'👍',':fire:':'🔥',':laugh:':'😂',':sad:':'😢'};

function emojify(text){ return text.replace(/:\w+:/g,m=>EMOJI[m]||m); }

/* UI functions */
function appendMsg(msgObj, side='friend'){
  // msgObj: {id,sender,senderSocket,text,time,replyTo,ticks}
  const el = document.createElement('div');
  el.className = 'msg ' + (side === 'me' ? 'me' : 'friend');
  el.dataset.id = msgObj.id;
  const replyHtml = msgObj.replyTo ? `<div class="meta"><em>reply: ${escapeHtml(msgObj.replyTo.text)}</em></div>` : '';
  el.innerHTML = `
    ${replyHtml}
    <div class="meta"><strong>${escapeHtml(msgObj.sender)}</strong> <small>${msgObj.time}</small></div>
    <div class="text">${emojify(escapeHtml(msgObj.text))} <span class="ticks" id="tick-${msgObj.id}">${msgObj.ticks||''}</span></div>
  `;
  // click to send seen and to prepare reply
  el.addEventListener('click', () => {
    if (side === 'friend') {
      // send seen ack to original sender
      if (msgObj.senderSocket) socket.emit('seen', { to: msgObj.senderSocket, id: msgObj.id });
      // open reply UI
      replyBox.classList.remove('hidden');
      replyText.textContent = `${msgObj.sender}: ${msgObj.text.slice(0,100)}`;
      replyBox.dataset.replyId = msgObj.id;
    }
  });
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, ch=>{
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
}); }

/* send message */
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  else socket.emit('typing', { sender: nameInput.value.trim() || username || 'Anonymous' });
});

function sendMessage(){
  if (!nameInput.value.trim() && !username) { alert('Enter your name first'); nameInput.focus(); return; }
  username = nameInput.value.trim() || username || `User${Math.floor(Math.random()*1000)}`;
  localStorage.setItem('chat_name', username);

  const text = messageInput.value.trim();
  if (!text) return;
  const id = uid();
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const msgObj = {
    id,
    sender: username,
    senderSocket: socket.id,
    text,
    time,
    replyTo: replyBox.dataset.replyId ? { id: replyBox.dataset.replyId, text: replyText.textContent } : null,
    ticks: '✓'
  };
  // append locally as me
  appendMsg(msgObj, 'me');
  // clear reply
  replyBox.classList.add('hidden'); replyText.textContent = ''; replyBox.dataset.replyId = '';
  // send to server
  socket.emit('chat-message', msgObj);
  messageInput.value = '';
  socket.emit('stop-typing', { sender: username });
}

/* cancel reply */
cancelReply.addEventListener('click', () => { replyBox.classList.add('hidden'); replyText.textContent=''; replyBox.dataset.replyId=''; });

/* typing indicator */
let typingTimeout;
messageInput.addEventListener('input', () => {
  socket.emit('typing', { sender: nameInput.value.trim() || username || 'Anonymous' });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(()=> socket.emit('stop-typing', { sender: nameInput.value.trim() || username }), 900);
});

/* incoming events */
socket.on('connect', () => {
  if (username) socket.emit('register', username);
});

socket.on('chat-message', (msg) => {
  // show only if from others
  if (msg.sender !== (nameInput.value.trim() || username)) {
    // store senderSocket for ack
    msg.senderSocket = msg.senderSocket || msg.senderSocket;
    appendMsg(msg, 'friend');
    // send delivered ack
    if (msg.senderSocket) socket.emit('delivered', { to: msg.senderSocket, id: msg.id });
  }
});

/* delivered ack */
socket.on('delivered', ({ id }) => {
  const el = document.getElementById(`tick-${id}`);
  if (el) el.textContent = '✓✓';
});

/* seen ack */
socket.on('seen', ({ id }) => {
  const el = document.getElementById(`tick-${id}`);
  if (el) { el.textContent = '✓✓ (seen)'; el.style.color = '#0b7'; }
});

/* typing */
socket.on('typing', ({ sender }) => {
  if (sender !== (nameInput.value.trim() || username)) typingEl.textContent = `${sender} is typing...`;
});
socket.on('stop-typing', ({ sender }) => {
  if (sender !== (nameInput.value.trim() || username)) typingEl.textContent = '';
});

/* ---------------- WebRTC Screen Share (signaling over socket.io) ---------------- */
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

    pc.onicecandidate = e => { if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate }); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { offer, from: socket.id, sender: username });
  } catch (err) {
    console.error('Screen share failed', err);
    alert('Screen share failed: ' + (err.message || err));
  }
}

socket.on('webrtc-offer', async ({ offer, from, sender }) => {
  try {
    // viewer replies with answer and shows remote stream
    const remotePc = new RTCPeerConnection(pcConfig);
    remotePc.ontrack = e => {
      localVideo.srcObject = e.streams[0];
      localVideo.classList.remove('hidden');
    };
    remotePc.onicecandidate = e => { if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate, to: from }); };

    await remotePc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await remotePc.createAnswer();
    await remotePc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { answer, to: from });
  } catch (err) { console.error(err); }
});

socket.on('webrtc-answer', async ({ answer }) => {
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('webrtc-candidate', async ({ candidate }) => {
  try { if (candidate && pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){console.error(e)}
});

/* PWA install */
let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.style.display = 'inline-block';
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt = null;
  installBtn.style.display = 'none';
});
