/* client/script.js
   Events used:
   - user:join (emit)
   - chat:send (emit)
   - chat:new  (receive)
   - chat:status (receive) { id, status:'sent'|'delivered'|'seen' }
   - chat:typing (emit/receive) { from, isTyping }
   - chat:seen (emit) { id, from }
   - screen:start / screen:stop (emit/receive)
*/

(() => {
  // DOM
  const nameModal = document.getElementById('nameModal');
  const nameInput = document.getElementById('nameInput');
  const nameSubmit = document.getElementById('nameSubmit');

  const appEl = document.getElementById('app');
  const messagesEl = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const typingEl = document.getElementById('typing');
  const onlineList = document.getElementById('onlineList');
  const replyBox = document.getElementById('replyBox');
  const replyPreview = document.getElementById('replyPreview');
  const cancelReply = document.getElementById('cancelReply');
  const startShareBtn = document.getElementById('startShare');
  const localVideo = document.getElementById('localVideo');
  const shareStatus = document.getElementById('shareStatus');
  const installBtn = document.getElementById('installBtn');

  let username = '';
  let socket = null;
  let typingTimer = null;
  const pending = new Map(); // id -> element

  // helpers
  const uid = () => 'm_' + Math.random().toString(36).slice(2,9);
  const now = () => new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const emojify = (t) => t.replace(/:\w+:/g, m => ({':smile:':'😄',':heart:':'❤️',':thumbsup:':'👍',':fire:':'🔥',':laugh:':'😂'}[m]||m));

  // PWA install handling
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.style.display = 'inline-block';
  });
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });

  // Name submit
  nameSubmit.addEventListener('click', onNameSubmit);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') onNameSubmit(); });

  function onNameSubmit(){
    const val = nameInput.value.trim();
    if (!val) { nameInput.focus(); return; }
    username = val;
    nameModal.classList.add('hidden');
    appEl.classList.remove('hidden');
    startSocket();
  }

  function startSocket(){
    if (socket && socket.connected) return;
    socket = io();

    socket.on('connect', () => {
      socket.emit('user:join', username);
    });

    // presence list: server emits presence:list
    socket.on('presence:list', (list) => {
      onlineList.innerHTML = '';
      list.forEach(n => {
        const li = document.createElement('li');
        li.textContent = n === username ? `${n} (you)` : n;
        onlineList.appendChild(li);
      });
    });

    // incoming messages from others
    socket.on('chat:new', (payload) => {
      if (!payload) return;
      if (payload.from === username) return; // safety: ignore echo
      appendMessage(payload, 'friend');
      // after we show incoming message, notify sender seen
      socket.emit('chat:seen', { id: payload.id, from: payload.from });
    });

    // status updates for my messages
    socket.on('chat:status', ({ id, status }) => {
      const el = pending.get(id);
      if (!el) return;
      const tick = el.querySelector('.ticks');
      if (!tick) return;
      if (status === 'sent') tick.textContent = '✓';
      if (status === 'delivered') tick.textContent = '✓✓';
      if (status === 'seen') { tick.textContent = '✓✓'; tick.classList.add('seen'); }
    });

    // typing
    socket.on('chat:typing', ({ from, isTyping }) => {
      if (from === username) return;
      if (isTyping) {
        typingEl.classList.remove('hidden');
        typingEl.textContent = `${from} is typing…`;
      } else {
        typingEl.classList.add('hidden');
        typingEl.textContent = '';
      }
    });

    // screen share notifications
    socket.on('screen:start', ({ by }) => {
      shareStatus.textContent = `Screen shared by ${by}`;
    });
    socket.on('screen:stop', () => {
      shareStatus.textContent = 'No screen shared';
      localVideo.srcObject = null;
      localVideo.classList.add('hidden');
    });
  }

  // append message to UI
  function appendMessage({ id, text, from, ts }, side='friend'){
    const el = document.createElement('div');
    el.className = 'msg ' + (side === 'me' ? 'me' : 'friend');
    const time = ts || now();
    el.innerHTML = `
      <div class="meta"><strong>${escapeHtml(from)}</strong> <span class="time">${time}</span></div>
      <div class="text">${emojify(escapeHtml(text))} ${side==='me' ? `<span class="ticks">` : ''}</div>
    `;
    // add tick span only for me
    if (side === 'me'){
      const ticks = document.createElement('span');
      ticks.className = 'ticks';
      ticks.textContent = ''; // will be updated by status events
      el.querySelector('.text').appendChild(ticks);
    }

    // clicking a friend's message triggers reply preview and seen ack to sender
    if (side === 'friend'){
      el.addEventListener('click', () => {
        replyBox.classList.remove('hidden');
        replyPreview.textContent = `${from}: ${text.slice(0,80)}`;
        replyBox.dataset.replyId = id;
      });
    }

    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    if (side === 'me') pending.set(id, el);
  }

  // send message
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
    else {
      if (socket) socket.emit('chat:typing', { from: username, isTyping: true });
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { if (socket) socket.emit('chat:typing', { from: username, isTyping: false }); }, 900);
    }
  });

  function sendMessage(){
    const text = messageInput.value.trim();
    if (!text) return;
    const id = uid();
    const ts = now();
    const payload = { id, text, from: username, ts, replyTo: replyBox.dataset.replyId || null };

    // locally show as me immediately (no echo)
    appendMessage(payload, 'me');

    // emit to server for others
    if (socket && socket.connected) {
      socket.emit('chat:send', payload);
    }

    messageInput.value = '';
    if (replyBox.dataset.replyId) {
      replyBox.classList.add('hidden');
      replyPreview.textContent = '';
      replyBox.dataset.replyId = '';
    }
  }

  cancelReply.addEventListener('click', () => {
    replyBox.classList.add('hidden');
    replyPreview.textContent = '';
    replyBox.dataset.replyId = '';
  });

  // start screen share (broadcaster)
  startShareBtn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:false });
      localVideo.srcObject = stream;
      localVideo.classList.remove('hidden');
      shareStatus.textContent = 'You are sharing your screen';
      if (socket) socket.emit('screen:start', { by: username });

      // stop handling
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        localVideo.srcObject = null;
        localVideo.classList.add('hidden');
        shareStatus.textContent = 'No screen shared';
        if (socket) socket.emit('screen:stop');
      });
    } catch (err) {
      alert('Screen share error: ' + (err.message || err));
    }
  });

  // small debug visibility
  window.__chat = { appendMessage, pending, uid };
  // register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  }
})();
