const socket = io();

// Get elements
const messagesDiv = document.getElementById("messages");
const input = document.getElementById("messageInput");
const typingDiv = document.getElementById("typing");

let username = prompt("Enter your name:") || "User";

// Send message
function sendMessage() {
  const msg = input.value.trim();
  if (msg !== "") {
    appendMessage(msg, "me");
    socket.emit("chat message", { text: msg, user: username });
    input.value = "";
  }
}

// Append message to UI
function appendMessage(text, type) {
  const div = document.createElement("div");
  div.classList.add("message", type);
  div.innerHTML = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Receive message
socket.on("chat message", (data) => {
  if (data.user !== username) {
    appendMessage(`<b>${data.user}:</b> ${data.text}`, "friend");
  }
});

// Typing indicator
input.addEventListener("input", () => {
  socket.emit("typing", username);
});

socket.on("typing", (name) => {
  typingDiv.textContent = `${name} is typing...`;
  setTimeout(() => {
    typingDiv.textContent = "";
  }, 2000);
});
