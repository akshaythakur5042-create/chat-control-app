/* client/script.js */
const socket = io(); // connect to same origin
const messagesEl = document.getElementById('messages');
const nameInput = document.getElementById('nameInput');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const shareBtn = document.getElementById('shareBtn');
const typingEl = document.getElementById('typing');
const replyBox = document.getElementById('replyBox');
const replyPreview = document.getElementById('replyPreview');
const cancelReply = document.getElementById('cancelReply');
const installBtn = document.getElementById('installBtn');
const localVideo = document.getElementById('localVideo');

let username = localStorage.getItem('chat_name') || '';
if (username) nameInput.value = username;

nameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    username = nameInput.value.trim() || username;
    if (username) localStorage.setItem('chat_name', username);
    socket.emit('register', username);
    nameInput.blur();
  }
});
nameInput.addEventListener('blur', () => {
  username = nameInput.value.trim() || username;
  if (username) localStorage.setItem('chat_name', username);
  socket.emit('register', username);
});

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
  else socket.emit('typing', { sender: username || 'Anonymous' });
});
cancelReply.addEventListener('click', () => { replyBox.classList.add('hidden'); replyPreview.textContent = ''; replyBox.dataset.replyId = ''; });

/* UID */
const uid = () => Math.random().toString(36).slice(2,9);

/* emoji map */
const EMOJI = {':smile:':'😄',':heart:':'❤️',':thumbsup:':'👍',':fire:':'🔥',':laugh:':'😂',':sad:':'😢'};
function emojify(text){ return text.replace(/:\w+:/g,m=>EMOJI[m]||m); }

/* escape HTML */
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* append message */
function appendMessage(msgObj, side='friend'){
  // msgObj: {id,sender,senderSocket,text,time,replyTo,ticks}
  const el = document.createElement('div');
  el.className = 'msg ' + (side === 'me' ? 'me' : 'friend');
  el.dataset.id = msgObj.id;
  const replyHtml = msgObj.replyTo ? `<div class="reply">${escapeHtml(msgObj.replyTo.sender)}: ${escapeHtml(msgObj.replyTo.text)}</div>` : '';
  el.innerHTML = `
    ${replyHtml}
    <div class="meta"><strong>${escapeHtml(msgObj.sender)}</strong> <small>${msgObj.time}</small></div>
    <div class="text">${emojify(escapeHtml(msgObj.text))} <span class="ticks" id="tick-${msgObj.id}">${msgObj.ticks||''}</span></div>
  `;
  // click on friend message -> mark seen and set reply
  el.addEventListener('click', () => {
    if (side === 'friend') {
      // send seen ack to original sender
      if (msgObj.senderSocket) socket.emit('seen', { to: msgObj.senderSocket, id: msgObj.id });
      // show reply preview
      replyBox.classList.remove('hidden');
      replyPreview.textContent = `${msgObj.sender}: ${msgObj.text.slice(0,80)}`;
      replyBox.dataset.replyId = msgObj.id;
    }
  });
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* send message */
function sendMessage(){
  if (!username) { alert('Please enter your name at the top and press Enter.'); nameInput.focus(); return; }
  const text = messageInput.value.trim();
  if (!text) return;
  const id = uid();
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const msgObj = {
    id, sender: username, senderSocket: socket.id, text, time,
    replyTo: replyBox.dataset.replyId ? { id: replyBox.dataset.replyId, text: replyPreview.textContent } : null,
    ticks:'✓'
  };
  // append locally as me
  appendMessage(msgObj, 'me');
  // clear reply UI
  replyBox.classList.add('hidden'); replyPreview.textContent = ''; replyBox.dataset.replyId = '';
  // emit to server
  socket.emit('chat-message', msgObj);
  messageInput.value = '';
  socket.emit('stop-typing', { sender: username });
}

/* socket events */
socket.on('connect', () => {
  if (username) socket.emit('register', username);
});

/* incoming message */
socket.on('chat-message', (msg) => {
  // show only when message is from others
  if (msg.senderSocket !== socket.id) {
    appendMessage(msg, 'friend');
    // send delivered ack back to original sender
    if (msg.senderSocket) socket.emit('delivered', { to: msg.senderSocket, id: msg.id });
  }
});

/* delivered ack */
socket.on('delivered', ({ id }) => {
  const tickEl = document.getElementById(`tick-${id}`);
  if (tickEl) tickEl.textContent = '✓✓';
});

/* seen ack */
socket.on('seen', ({ id }) => {
  const tickEl = document.getElementById(`tick-${id}`);
  if (tickEl) tickEl.textContent = '✓✓ (seen)';
});

/* typing */
socket.on('typing', ({ sender }) => {
  if (sender !== username) typingEl.textContent = `${sender} is typing...`;
});
socket.on('stop-typing', ({ sender }) => {
  if (sender !== username) typingEl.textContent = '';
});

/* ---------------- WebRTC screen share (signaling) ---------------- */
const pcConfig = { iceServers:[{ urls:'stun:stun.l.google.com:19302' }] };
let pc = null;

shareBtn.addEventListener('click', startScreenShare);

async function startScreenShare(){
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video:true });
    localVideo.srcObject = stream;
    localVideo.classList.remove('hidden');

    pc = new RTCPeerConnection(pcConfig);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));

    pc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate }); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { offer, from: socket.id, sender: username });
  } catch (err) {
    console.error('Screen share error:', err);
    alert('Screen share failed: ' + (err.message || err));
  }
}

/* someone sent an offer (viewer side) */
socket.on('webrtc-offer', async ({ offer, from }) => {
  try {
    const viewerPc = new RTCPeerConnection(pcConfig);
    viewerPc.ontrack = (e) => {
      // show remote screen in localVideo (viewer)
      localVideo.srcObject = e.streams[0];
      localVideo.classList.remove('hidden');
    };
    viewerPc.onicecandidate = (e) => { if (e.candidate) socket.emit('webrtc-candidate', { candidate: e.candidate, to: from }); };

    await viewerPc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await viewerPc.createAnswer();
    await viewerPc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { answer, to: from });
  } catch (err) { console.error(err); }
});

socket.on('webrtc-answer', async ({ answer }) => { if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer)); });
socket.on('webrtc-candidate', async ({ candidate }) => { try { if (candidate && pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e){console.error(e)} });

/* ---------------- PWA install prompt --------------- */
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
