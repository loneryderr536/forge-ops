const vscode = acquireVsCodeApi();

const chatLog = document.getElementById('chat-log');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const stopBtn = document.getElementById('stop-btn');
const undoBtn = document.getElementById('undo-btn');
const meterEl = document.getElementById('meter');
const bannerEl = document.getElementById('banner');

let currentAssistantEl = null;

sendBtn.addEventListener('click', () => {
  const text = promptInput.value.trim();
  if (!text) return;
  vscode.postMessage({ type: 'send', text });
  promptInput.value = '';
  appendUserMessage(text);
  stopBtn.disabled = false;
});

stopBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'stop' });
  stopBtn.disabled = true;
});

undoBtn.addEventListener('click', () => {
  vscode.postMessage({ type: 'undoRun' });
});

function appendUserMessage(text) {
  const el = document.createElement('div');
  el.className = 'message-box user';
  el.textContent = '👤 You: ' + text;
  chatLog.appendChild(el);
  chatLog.scrollTop = chatLog.scrollHeight;
  currentAssistantEl = null;
}

window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'text': {
      if (!currentAssistantEl) {
        currentAssistantEl = document.createElement('div');
        currentAssistantEl.className = 'message-box assistant';
        chatLog.appendChild(currentAssistantEl);
      }
      currentAssistantEl.textContent += msg.delta;
      chatLog.scrollTop = chatLog.scrollHeight;
      break;
    }
    case 'tool': {
      const toolEl = document.createElement('div');
      toolEl.className = 'tool-row';
      toolEl.textContent = `⚙ ${msg.name}: ${msg.detail}`;
      chatLog.appendChild(toolEl);
      chatLog.scrollTop = chatLog.scrollHeight;
      break;
    }
    case 'thread': {
      const thEl = document.createElement('div');
      thEl.className = 'subagent-thread';
      thEl.textContent = `📊 Statistician Thread (${msg.kind}): ${msg.threadId}`;
      chatLog.appendChild(thEl);
      chatLog.scrollTop = chatLog.scrollHeight;
      break;
    }
    case 'banner': {
      bannerEl.className = msg.level;
      bannerEl.textContent = msg.text;
      bannerEl.style.display = 'block';
      break;
    }
    case 'meter': {
      meterEl.textContent = `Context: ${Math.round(msg.used / 1000 * 10) / 10}k / ${Math.round(msg.budget / 1000)}k tokens · ${msg.files} files`;
      break;
    }
    case 'done': {
      stopBtn.disabled = true;
      currentAssistantEl = null;
      break;
    }
  }
});
