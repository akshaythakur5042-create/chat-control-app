/* client/script.js */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const gate = $('#gate');
  const app = $('#app');
  const messagesEl = $('#messages');
  const inputEl = $('#messageInput');
  const sendBtn = $('#sendBtn');
  const typingEl = $('#typing');
  const emojiBtn = $('#emojiBtn');
  const installBtn = $('#installBtn');
  const shareBtn = $('#shareBtn');
  const nameInput = $('#nameInput');
  const continueBtn = $('#continueBtn');
  const localVideo = $('#localVideo');
  const remoteVideo = $('#remoteVideo');

  let myName = '';
  let socket;
  let typingTimeout;
  let deferredPrompt;
  const pending = new Map(); // id -> li element for ticks

  // PWA install capture
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove('hidden');
  });
  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt = null;
      installBtn.classList.add('hidden');
    }
  });

  continueBtn.addEventListener('click', startApp);
  nameInput.addEventListener('keydown', (e) => (e.key === 'Enter') && startApp());

  function startApp(){
    const n = nameInput.value.trim();
    if(!n){ nameInput.focus(); return; }
    myName = n;
    gate.classList.add('hidden');
    app.classList.remove('hidden');

    // connect socket with name (IMPORTANT: replace with your Render domain if different)
    socket = io('/', { query: { name: myName } });

    wireSocket();
    wireUI();
  }

  function wireUI(){
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendMessage();
      emitTyping();
    });
    emojiBtn.addEventListener('click', () => {
      inputEl.value += '🙂';
      inputEl.focus();
      emitTyping();
    });
    shareBtn.addEventListener('click', startScreenShare);
  }

  function msgTemplate({ id, text, from, outgoing, ts }){
    const li = document.createElement('li');
    li.className = `msg ${outgoing ? 'outgoing' : 'incoming'}`;
    li.dataset.id = id;

    const initials = (from || '?').split(' ').map(s => s[0]?.toUpperCase()).join('').slice(0,2) || '?';

    li.innerHTML = `
      <div class="avatar">${initials}</div>
      <div class="bubble">
        ${!outgoing ? `<div class="name">${from}</div>` : ``}
        <div class="text">${escapeHtml(text)}</div>
        <div class="meta">
          <span class="time">${new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
          ${outgoing ? `<span class="ticks" data-ticks>✓</span>` : ``}
        </div>
      </div>
    `;
    return li;
  }

  function appendMessage(el){
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function sendMessage(){
    const text = inputEl.value.trim();
    if(!text) return;

    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const ts = Date.now();

    // Add immediately to UI as outgoing (NO echo)
    const li = msgTemplate({ id, text, from: myName, outgoing:true, ts });
    appendMessage(li);
    pending.set(id, li);

    // emit to server
    socket.emit('chat:send', { id, text, from: myName, ts });

    // clear box
    inputEl.value = '';
    emitTypingStop();
  }

  function wireSocket(){
    socket.on('connect', () => console.log('Connected'));

    // others typing
    socket.on('chat:typing', ({ name, isTyping }) => {
      typingEl.textContent = isTyping ? `${name} is typing…` : '';
      typingEl.classList.toggle('hidden', !isTyping);
    });

    // incoming new message from others
    socket.on('chat:new', (payload) => {
      const { id, text, from, ts } = payload;
      // render incoming
      const li = msgTemplate({ id, text, from, outgoing:false, ts });
      appendMessage(li);
      // notify sender "seen" when we rendered it (you can delay this if you want)
      socket.emit('chat:seen', { id, from });
    });

    // status updates for my outgoing messages
    socket.on('chat:status', ({ id, status }) => {
      const li = pending.get(id);
      if (!li) return;
      const ticks = li.querySelector('[data-ticks]');
      if (!ticks) return;
      if (status === 'sent') ticks.textContent = '✓';
      if (status === 'delivered') ticks.textContent = '✓✓';
      if (status === 'seen') {
        ticks.textContent = '✓✓';
        ticks.style.color = '#34b7f1'; // blue ticks
      }
    });

    // presence (optional UI hooks)
    socket.on('presence:join', ({ name }) => {
      toast(`${name} joined`);
    });
    socket.on('presence:leave', ({ name }) => {
      toast(`${name} left`);
    });
  }

  // typing helpers
  function emitTyping(){
    socket.emit('chat:typing', true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(emitTypingStop, 1200);
  }
  function emitTypingStop(){
    socket.emit('chat:typing', false);
  }

  // simple toast
  let toastTimer;
  function toast(msg){
    clearTimeout(toastTimer);
    let t = document.querySelector('.toast');
    if(!t){
      t = document.createElement('div');
      t.className = 'toast';
      Object.assign(t.style, {
        position:'fixed', left:'50%', transform:'translateX(-50%)',
        bottom:'86px', background:'rgba(0,0,0,.7)', color:'#fff',
        padding:'8px 12px', borderRadius:'10px', zIndex:9999
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    toastTimer = setTimeout(()=> t.style.opacity='0', 1500);
  }

  // Screen share (WebRTC P2P)
  let pc;
  async function startScreenShare(){
    try{
      const stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
      localVideo.srcObject = stream;
      localVideo.classList.remove('hidden');

      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.classList.remove('hidden');
      };
      pc.onicecandidate = ({ candidate }) => {
        if(candidate) socket.emit('webrtc:ice', candidate);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { sdp: offer.sdp });
    }catch(err){
      alert('Screen share error: ' + err.message);
    }
  }

  // receive signaling
  (function signal(){
    let remoteSet = false;
    socket?.on('webrtc:offer', async ({ sdp }) => {
      pc = new RTCPeerConnection({ iceServers:[{urls:'stun:stun.l.google.com:19302'}] });
      pc.ontrack = (e) => {
        remoteVideo.srcObject = e.streams[0];
        remoteVideo.classList.remove('hidden');
      };
      pc.onicecandidate = ({ candidate }) => {
        if(candidate) socket.emit('webrtc:ice', candidate);
      };
      await pc.setRemoteDescription({ type:'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { sdp: answer.sdp });
    });

    socket?.on('webrtc:answer', async ({ sdp }) => {
      if (!pc || remoteSet) return;
      await pc.setRemoteDescription({ type:'answer', sdp });
      remoteSet = true;
    });

    socket?.on('webrtc:ice', async (candidate) => {
      try{
        await pc?.addIceCandidate(candidate);
      }catch(e){ console.warn(e); }
    });
  })();

  // helpers
  function escapeHtml(str){
    return str.replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }
})();
