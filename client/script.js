/* globals io */
const $ = (q) => document.querySelector(q);
const messagesEl = $('#messages');
const typingEl = $('#typing');
const listEl = $('#onlineList');
const shareStatusEl = $('#shareStatus');
const messageInput = $('#messageInput');
const sendBtn = $('#sendBtn');
const emojiBtn = $('#emojiBtn');
const startShareBtn = $('#startShareBtn');
const stopShareBtn = $('#stopShareBtn');
const localVideo = $('#localVideo');
const remoteVideo = $('#remoteVideo');
const gate = $('#gate');
const enterBtn = $('#enterBtn');
const nameInput = $('#nameInput');
const app = $('#app');
const installBtn = $('#installBtn');
$('#year').textContent = new Date().getFullYear();

let socket;
let myName = '';
let typingTimeout = null;

/* PWA Install */
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.disabled = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.disabled = true;
});

/* Name prompt -> enter app */
enterBtn.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.focus();
    return;
  }
  myName = name;
  gate.classList.add('hidden');
  app.classList.remove('hidden');

  // Optional: enable background image if present
  fetch('./bg.jpg', { method: 'HEAD' })
    .then(res => {
      if (res.ok) document.body.classList.add('has-bg');
    })
    .catch(()=>{});

  startApp();
});

function startApp(){
  // Use same origin (works for local & Render)
  socket = io();

  socket.emit('user:join', myName);

  socket.on('presence:update', (names) => {
    listEl.innerHTML = '';
    names.forEach(n => {
      const li = document.createElement('li');
      li.textContent = n === myName ? `${n} (you)` : n;
      listEl.appendChild(li);
    });
  });

  // Incoming message (never echo back self from server)
  socket.on('chat:message', (payload) => {
    const { id, text, from } = payload;
    addMessage({ text, from, mine: false, id });
  });

  // Delivery receipt (double tick gray)
  socket.on('chat:delivered', ({ id }) => {
    markDelivered(id);
  });

  // Seen receipt (double tick blue)
  socket.on('chat:seen', ({ lastId, from }) => {
    markSeenUpTo(lastId);
  });

  // Typing indicator
  socket.on('chat:typing', ({ from, isTyping }) => {
    if (from === myName) return;
    typingEl.textContent = isTyping ? `${from} is typing…` : '';
    typingEl.classList.toggle('hidden', !isTyping);
  });

  /* --------------- Chat composer events --------------- */
  messageInput.addEventListener('input', () => {
    socket.emit('chat:typing', { from: myName, isTyping: true });
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      socket.emit('chat:typing', { from: myName, isTyping: false });
    }, 900);
  });

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendMessage();
  });

  emojiBtn.addEventListener('click', () => {
    messageInput.value += ' 😊';
    messageInput.focus();
  });

  window.addEventListener('focus', () => {
    // mark last message seen
    const last = messages[messages.length - 1];
    if (last) socket.emit('chat:seen', { lastId: last.id, from: myName });
  });

  /* --------------- Screen share signaling --------------- */
  setupScreenShare();
}

/* --------------- Chat UI helpers --------------- */
const messages = []; // {id, text, from, mine, delivered, seen}
function uid(){ return Math.random().toString(36).slice(2)+Date.now().toString(36); }

function addMessage({ id = uid(), text, from, mine = false }){
  const m = { id, text, from, mine, delivered: mine ? true : false, seen: false };
  messages.push(m);

  const wrap = document.createElement('div');
  wrap.className = `msg ${mine ? 'me' : 'them'}`;

  const body = document.createElement('div');
  body.textContent = text;
  wrap.appendChild(body);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const who = document.createElement('span');
  who.textContent = mine ? myName : from;
  const time = document.createElement('span');
  time.textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const ticks = document.createElement('span');
  ticks.className = 'tick';
  ticks.dataset.id = m.id;
  ticks.textContent = mine ? '✓' : '';
  meta.appendChild(who);
  meta.appendChild(time);
  meta.appendChild(ticks);

  wrap.appendChild(meta);
  messagesEl.appendChild(wrap);
  messagesEl.scrollTop = messagesEl.scrollHeight;

  return m.id;
}

function markDelivered(id){
  const m = messages.find(x => x.id === id);
  if (!m) return;
  m.delivered = true;
  const el = messagesEl.querySelector(`.tick[data-id="${id}"]`);
  if (el) el.textContent = '✓✓';
}

function markSeenUpTo(lastId){
  let reached = false;
  for (let i = messages.length - 1; i >= 0; i--){
    const m = messages[i];
    if (m.mine){
      const el = messagesEl.querySelector(`.tick[data-id="${m.id}"]`);
      if (el){ el.textContent = '✓✓'; el.classList.add('seen'); }
    }
    if (m.id === lastId){ reached = true; break; }
  }
  return reached;
}

function sendMessage(){
  const text = messageInput.value.trim();
  if (!text) return;
  const id = uid();
  // Render my bubble immediately (no server echo)
  addMessage({ id, text, from: myName, mine: true });
  socket.emit('chat:message', { id, text, from: myName });
  messageInput.value = '';
  socket.emit('chat:typing', { from: myName, isTyping: false });
}

/* --------------- Screen share (WebRTC) --------------- */
let localStream = null;
const peers = {}; // viewerId -> RTCPeerConnection

const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478?transport=udp' }
  ]
};

function setupScreenShare(){
  startShareBtn.addEventListener('click', startScreenShare);
  stopShareBtn.addEventListener('click', stopScreenShare);

  // Notify viewers that broadcast is available
  socket.on('screen:broadcast:available', ({ by }) => {
    shareStatusEl.textContent = `Screen available from ${by}. Click to view.`;
    // Auto-start watching
    socket.emit('screen:watcher');
  });

  socket.on('screen:broadcast:stopped', () => {
    shareStatusEl.textContent = 'No screen shared';
    remoteVideo.srcObject = null;
  });

  socket.on('screen:watcher', async (id) => {
    // A viewer connected; create a peer for them
    const pc = new RTCPeerConnection(rtcConfig);
    peers[id] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('screen:candidate', id, e.candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('screen:offer', id, pc.localDescription);
  });

  socket.on('screen:offer', async (id, description) => {
    // We are viewer
    const pc = new RTCPeerConnection(rtcConfig);
    peers[id] = pc;

    pc.ontrack = (e) => {
      remoteVideo.srcObject = e.streams[0];
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) socket.emit('screen:candidate', id, e.candidate);
    };

    await pc.setRemoteDescription(description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('screen:answer', id, pc.localDescription);
  });

  socket.on('screen:answer', async (id, description) => {
    const pc = peers[id];
    if (!pc) return;
    await pc.setRemoteDescription(description);
  });

  socket.on('screen:candidate', async (id, candidate) => {
    const pc = peers[id];
    if (!pc) return;
    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      console.error('ICE add error', err);
    }
  });
}

async function startScreenShare(){
  try{
    localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    localVideo.srcObject = localStream;
    localVideo.classList.remove('hidden');
    stopShareBtn.disabled = false;
    startShareBtn.disabled = true;
    shareStatusEl.textContent = `Sharing your screen…`;
    socket.emit('screen:broadcast:start');

    // If user stops from browser UI
    localStream.getVideoTracks()[0].addEventListener('ended', stopScreenShare);
  }catch(err){
    alert('Screen share error: ' + err.message);
  }
}

function stopScreenShare(){
  if (localStream){
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  localVideo.classList.add('hidden');
  startShareBtn.disabled = false;
  stopShareBtn.disabled = true;
  shareStatusEl.textContent = 'No screen shared';
  socket.emit('screen:broadcast:stop');

  // Close all peers
  Object.values(peers).forEach(pc => pc.close());
  for (const k in peers) delete peers[k];
}
