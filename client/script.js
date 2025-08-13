/* client/script.js */
const socket = io(); // same-origin
// Elements
const nameModal   = document.getElementById('nameModal');
const nameField   = document.getElementById('nameField');
const saveNameBtn = document.getElementById('saveNameBtn');

const messagesEl  = document.getElementById('messages');
const typingEl    = document.getElementById('typing');
const replyBox    = document.getElementById('replyBox');
const replyPreview= document.getElementById('replyPreview');
const cancelReply = document.getElementById('cancelReply');

const nameInline  = document.getElementById('nameInline');
const messageInput= document.getElementById('messageInput');
const sendBtn     = document.getElementById('sendBtn');
const shareBtn    = document.getElementById('shareBtn');
const installBtn  = document.getElementById('installBtn');
const localVideo  = document.getElementById('localVideo');

// Username flow (first-run)
let username = localStorage.getItem('chat_name') || '';
function showModal(){ nameModal.classList.remove('hidden'); nameField.focus(); }
function hideModal(){ nameModal.classList.add('hidden'); }

if (!username) showModal();
else nameInline.value = username;

saveNameBtn.onclick = () => {
  const val = nameField.value.trim();
  if (!val) return alert('Please enter your name');
  username = val;
  localStorage.setItem('chat_name', username);
  nameInline.value = username;
  hideModal();
  socket.emit('register', username);
};
nameField.addEventListener('keydown', e => { if (e.key === 'Enter') saveNameBtn.click(); });

// If user edits inline (desktop), update stored name
nameInline.addEventListener('blur', () => {
  if (!nameInline.value.trim()) { nameInline.value = username; return; }
  username = nameInline.value.trim();
  localStorage.setItem('chat_name', username);
  socket.emit('register', username);
});

// Helpers
const uid = () => Math.random().toString(36).slice(2,9);
const EMOJI = {':smile:':'😄',':heart:':'❤️',':thumbsup:':'👍',':fire:':'🔥',':laugh:':'😂',':sad:':'😢',':ok:':'👌',':star:':'⭐'};
const emojify = t => t.replace(/:\w+:/g,m=>EMOJI[m]||m);
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function appendMessage(msg, side='friend'){
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (side==='me'?'me':'friend');
  wrap.dataset.id = msg.id;

  const replyHTML = msg.replyTo ? `<div class="reply">${escapeHtml(msg.replyTo.sender)}: ${escapeHtml(msg.replyTo.text)}</div>` : '';

  wrap.innerHTML = `
    ${replyHTML}
    <div class="meta"><strong>${escapeHtml(msg.sender)}</strong> <small>${msg.time}</small></div>
    <div class="text">
      ${emojify(escapeHtml(msg.text))}
      <span class="ticks ${msg.seen?'seen':''}" id="tick-${msg.id}">${msg.ticks||''}</span>
    </div>
  `;

  // clicking a friend message → open reply mode + send seen ack
  if (side !== 'me') {
    wrap.addEventListener('click', () => {
      replyBox.classList.remove('hidden');
      replyPreview.textContent = `${msg.sender}: ${msg.text.slice(0,80)}`;
      replyBox.dataset.replyId = msg.id;
      if (msg.senderSocket) socket.emit('seen', { to: msg.senderSocket, id: msg.id });
    });
  }

  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

cancelReply.onclick = () => {
  replyBox.classList.add('hidden');
  replyPreview.textContent = '';
  replyBox.dataset.replyId = '';
};

// Sending
function sendMessage(){
  if (!username){ showModal(); return; }
  const text = messageInput.value.trim();
  if (!text) return;

  const id = uid();
  const time = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  const msg = {
    id, text, time,
    sender: username,
    senderSocket: socket.id,
    replyTo: replyBox.dataset.replyId ? { id: replyBox.dataset.replyId, sender: replyPreview.textContent.split(':')[0], text: replyPreview.textContent.split(': ').slice(1).join(': ') } : null,
    ticks: '✓'
  };

  // local append (me) without echo from server
  appendMessage(msg, 'me');

  // clear UI and emit to others
  replyBox.classList.add('hidden'); replyPreview.textContent=''; replyBox.dataset.replyId='';
  socket.emit('chat-message', msg);
  messageInput.value = '';
  socket.emit('stop-typing', { sender: username });
}
sendBtn.onclick = sendMessage;
messageInput.addEventListener('keydown', e=>{
  if (e.key === 'Enter'){ e.preventDefault(); sendMessage(); }
  else socket.emit('typing', { sender: username||'Anonymous' });
});

// Socket events
socket.on('connect', () => { if (username) socket.emit('register', username); });

socket.on('chat-message', (msg) => {
  if (msg.senderSocket !== socket.id) {
    appendMessage(msg, 'friend');
    if (msg.senderSocket) socket.emit('delivered', { to: msg.senderSocket, id: msg.id });
  }
});
socket.on('delivered', ({id})=>{
  const t = document.getElementById(`tick-${id}`); if (t) t.textContent='✓✓';
});
socket.on('seen', ({id})=>{
  const t = document.getElementById(`tick-${id}`); if (t){ t.textContent='✓✓'; t.classList.add('seen'); }
});
socket.on('typing', ({sender})=>{
  if (sender !== username) typingEl.textContent = `${sender} is typing…`;
});
socket.on('stop-typing', ({sender})=>{
  if (sender !== username) typingEl.textContent = '';
});

// ---------------- WebRTC screen share (simple broadcast) ----------------
const pcConfig = { iceServers:[{urls:'stun:stun.l.google.com:19302'}] };
let pc = null;

shareBtn.onclick = startScreenShare;

async function startScreenShare(){
  try{
    const stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
    localVideo.srcObject = stream;
    localVideo.classList.remove('hidden');

    pc = new RTCPeerConnection(pcConfig);
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = (e)=>{ if (e.candidate) socket.emit('webrtc-candidate', { candidate:e.candidate }); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { offer, from: socket.id, sender: username });
  }catch(err){
    console.error(err);
    alert('Screen share failed: ' + (err.message||err));
  }
}

// viewer side
socket.on('webrtc-offer', async ({ offer, from })=>{
  try{
    const vpc = new RTCPeerConnection(pcConfig);
    vpc.ontrack = (e)=>{
      localVideo.srcObject = e.streams[0];
      localVideo.classList.remove('hidden');
    };
    vpc.onicecandidate = (e)=>{ if (e.candidate) socket.emit('webrtc-candidate', { candidate:e.candidate, to: from }); };

    await vpc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await vpc.createAnswer();
    await vpc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { answer, to: from });
  }catch(e){ console.error(e); }
});
socket.on('webrtc-answer', async ({ answer })=>{
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});
socket.on('webrtc-candidate', async ({ candidate })=>{
  try{ if (candidate && pc) await pc.addIceCandidate(new RTCIceCandidate(candidate)); }catch(e){ console.error(e); }
});

// ---------------- PWA install ----------------
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  document.getElementById('installBtn').style.display = 'inline-block';
});
document.getElementById('installBtn').onclick = async ()=>{
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('installBtn').style.display = 'none';
};

// SW registration
if ('serviceWorker' in navigator){
  window.addEventListener('load', ()=> navigator.serviceWorker.register('/service-worker.js').catch(console.error));
}
