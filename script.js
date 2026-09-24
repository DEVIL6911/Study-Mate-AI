/* ═══════════════════════════════════════════════════════════════════
   Study Make AI — Main Script
   Single-page AI study companion powered by Gemini API + sql.js
   ═══════════════════════════════════════════════════════════════════

   ⚠️  WORKSHOP DEMO NOTICE:
   The API key is stored in localStorage and sent directly from the
   browser. In a production app you would NEVER expose an API key
   client-side — instead, proxy requests through your own backend.
   ═══════════════════════════════════════════════════════════════════ */

// ─── Configuration ──────────────────────────────────────────────────
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite'];
const getGeminiUrl = (model, key) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;

// System prompts per mode
const SYSTEM_PROMPTS = {
  explain: `You are Study Make AI, a friendly AI tutor for first-year college students.
Your job is to EXPLAIN topics in a simple, approachable way.
- Use analogies, examples, and step-by-step breakdowns.
- Assume the student is encountering the topic for the first time.
- Keep your language casual but accurate.
- Use markdown formatting for structure (headings, bullet points, bold).`,

  quiz: `You are Study Make AI, a friendly AI tutor for first-year college students.
Your job is to QUIZ the student.
- Generate 3-5 multiple-choice questions on the given topic.
- Label options A, B, C, D.
- After listing ALL questions, provide an "Answer Key" section at the end.
- Keep questions at an introductory college level.
- Use markdown formatting.`,

  revision: `You are Study Make AI, a friendly AI tutor for first-year college students.
Your job is to create a REVISION PLAN.
- Ask the student (if not provided) what topic and how much time they have.
- Create a day-by-day or session-by-session study plan.
- Include specific activities: read, practice problems, flashcards, review.
- Keep it realistic and encouraging.
- Use markdown formatting with clear headings.`,

  code: `You are Study Make AI, a friendly AI tutor for first-year college students.
Your job is to EXPLAIN CODE in a beginner-friendly way.
- Walk through the code line by line or block by block.
- Explain what each part does using plain language.
- Point out common patterns and potential pitfalls.
- If the code has bugs, gently point them out and suggest fixes.
- Use markdown code blocks with syntax highlighting.`
};

// ─── State ──────────────────────────────────────────────────────────
let db = null;                      // sql.js database instance
let currentMode = 'explain';        // active mode
let isStreaming = false;            // prevent double-sends
let conversationHistory = [];       // messages for Gemini context

// ─── DOM References ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const sidebar = $('#sidebar');
const sidebarToggle = $('#sidebar-toggle');
const mainEl = $('#main');
const emptyState = $('#empty-state');
const messagesEl = $('#messages');
const chatInput = $('#user-input');
const sendBtn = $('#send-btn');
const uploadBtn = $('#upload-btn');
const speakBtn = $('#speak-btn');
const fileInput = $('#file-input');
const attachmentBar = $('#attachment-bar');
const aboutGdgBtn = $('#about-gdg-btn');
const aboutGdgModal = $('#about-gdg-modal');
const closeAboutGdg = $('#close-about-gdg');
const clearHistBtn = $('#clear-history-btn');
const modeBtn = $('#mode-btn');
const modeLabel = $('#mode-label');
const modeDropdown = $('#mode-dropdown');
const settingsBtn = $('#settings-btn');
const settingsModal = $('#settings-modal');
const closeSettings = $('#close-settings');
const saveSettings = $('#save-settings');
const apiKeyInput = $('#api-key-input');
const userNameInput = $('#user-name-input');
const topbarApiBtn = $('#topbar-api-btn');

let selectedFiles = [];

// ─── Helpers ────────────────────────────────────────────────────────
function getApiKey() {
  return localStorage.getItem('sb_api_key') || '';
}

function getUserName() {
  return localStorage.getItem('sb_user_name') || '';
}

function modeDisplayName(mode) {
  return { explain: 'Explain', quiz: 'Quiz Me', revision: 'Revision Plan', code: 'Code Help' }[mode] || 'Explain';
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Very lightweight Markdown → HTML (handles the most common patterns) */
function renderMarkdown(text) {
  let html = escapeHTML(text);

  // Code blocks (```lang ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs — wrap remaining lone lines
  html = html.replace(/^(?!<[hulo]|<pre|<li)(.+)$/gm, '<p>$1</p>');

  // Clean up double line-breaks
  html = html.replace(/\n{2,}/g, '\n');

  return html;
}

// ─── Greeting ───────────────────────────────────────────────────────
function updateGreeting() {
  const name = getUserName();
  const greetingEl = $('.greeting');
  if (name) {
    greetingEl.innerHTML = `Hey ${escapeHTML(name)}, what are we<br/><span class="gradient-text">studying today?</span>`;
  } else {
    greetingEl.innerHTML = `Hey there, what are we<br/><span class="gradient-text">studying today?</span>`;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE (sql.js + localStorage persistence)
// ═══════════════════════════════════════════════════════════════════
async function initDB() {
  const SQL = await initSqlJs({
    locateFile: (file) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`
  });

  // Try to restore from localStorage
  const saved = localStorage.getItem('sb_db');
  if (saved) {
    const buf = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  // Ensure table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      role      TEXT    NOT NULL CHECK(role IN ('user', 'assistant')),
      content   TEXT    NOT NULL,
      mode      TEXT    DEFAULT 'explain',
      timestamp TEXT    DEFAULT (datetime('now'))
    );
  `);

  persistDB();
}

function persistDB() {
  if (!db) return;
  const data = db.export();
  const b64 = btoa(String.fromCharCode(...data));
  try {
    localStorage.setItem('sb_db', b64);
  } catch (e) {
    console.warn('Could not persist DB to localStorage:', e);
  }
}

function saveMessage(role, content, mode) {
  if (!db) return;
  db.run(
    'INSERT INTO messages (role, content, mode) VALUES (?, ?, ?)',
    [role, content, mode]
  );
  persistDB();
}

function loadMessages() {
  if (!db) return [];
  const results = db.exec('SELECT role, content, mode, timestamp FROM messages ORDER BY id ASC');
  if (!results.length) return [];
  return results[0].values.map(([role, content, mode, ts]) => ({ role, content, mode, timestamp: ts }));
}

function clearMessages() {
  if (!db) return;
  db.run('DELETE FROM messages');
  persistDB();
}

// ═══════════════════════════════════════════════════════════════════
// CHAT UI
// ═══════════════════════════════════════════════════════════════════
function showChatView() {
  emptyState.classList.add('hidden');
  messagesEl.classList.add('active');
}

function showEmptyState() {
  emptyState.classList.remove('hidden');
  messagesEl.classList.remove('active');
  messagesEl.innerHTML = '';
  conversationHistory = [];
  updateGreeting();
}

function getMimeTypeFromName(fileName) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const mimeMap = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };

  return mimeMap[ext] || 'application/octet-stream';
}

function renderAttachmentChips() {
  if (!attachmentBar) return;

  if (!selectedFiles.length) {
    attachmentBar.innerHTML = '';
    return;
  }

  attachmentBar.innerHTML = selectedFiles.map((file, index) => `
    <div class="attachment-chip">
      <span>${escapeHTML(file.name)}</span>
      <button class="attachment-chip-remove" type="button" data-index="${index}" aria-label="Remove ${escapeHTML(file.name)}">×</button>
    </div>
  `).join('');

  attachmentBar.querySelectorAll('.attachment-chip-remove').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      const index = Number(event.currentTarget.dataset.index);
      selectedFiles.splice(index, 1);
      renderAttachmentChips();
      updateSendButton();
    });
  });
}

function validateSelectedFiles(fileList) {
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return [];

  const total = selectedFiles.length + incoming.length;
  if (total > 3) {
    alert('You can upload up to 3 files in one question.');
    return [];
  }

  const oversized = incoming.filter((file) => (file.size / 1024 / 1024) > 5);
  if (oversized.length) {
    alert('Each file must be 5MB or smaller.');
    return [];
  }

  return incoming;
}

function updateSendButton() {
  if (!sendBtn) return;
  sendBtn.disabled = (chatInput.value.trim().length === 0 && selectedFiles.length === 0) || isStreaming;
}

function speakText(text) {
  if (!('speechSynthesis' in window)) {
    alert('Text-to-speech is not supported in this browser.');
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(
    text
      .replace(/[#*`_]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
  utterance.lang = 'en-US';
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function scrollToBottom() {
  const container = $('#chat-container');
  container.scrollTop = container.scrollHeight;
}

function appendMessage(role, content, animate = true) {
  showChatView();

  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;
  if (!animate) wrapper.style.animation = 'none';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? (getUserName()[0] || 'U').toUpperCase() : 'SM';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  if (role === 'assistant') {
    bubble.innerHTML = renderMarkdown(content);
  } else {
    bubble.innerHTML = `<p>${escapeHTML(content).replace(/\n/g, '<br>')}</p>`;
  }

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();

  return bubble;
}

function showTypingIndicator() {
  showChatView();
  const wrapper = document.createElement('div');
  wrapper.className = 'message assistant';
  wrapper.id = 'typing-msg';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'SM';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.innerHTML = `
    <div class="typing-indicator">
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>`;

  wrapper.appendChild(avatar);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  scrollToBottom();

  return wrapper;
}

function removeTypingIndicator() {
  const el = $('#typing-msg');
  if (el) el.remove();
}

async function fileToGeminiPart(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';

  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return {
    inline_data: {
      mime_type: file.type || getMimeTypeFromName(file.name),
      data: btoa(binary)
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// GEMINI API (streaming with SSE)
// ═══════════════════════════════════════════════════════════════════
async function sendToGemini(userMessage, attachedFiles = []) {
  const apiKey = getApiKey();
  if (!apiKey) {
    appendMessage('assistant', '⚠️ **No API key set.** Click **API Key** in the top bar (or Settings in the sidebar) and paste your Gemini API key to get started.');
    openSettings();
    return;
  }

  isStreaming = true;
  sendBtn.disabled = true;

  const userParts = [{ text: userMessage }];

  for (const file of attachedFiles) {
    userParts.push(await fileToGeminiPart(file));
  }

  // Build conversation context for Gemini
  conversationHistory.push({ role: 'user', parts: userParts });

  const requestBody = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPTS[currentMode] }]
    },
    contents: conversationHistory,
    generationConfig: {
      temperature: 0.7,
      topP: 0.9,
      maxOutputTokens: 4096
    }
  };

  const typingEl = showTypingIndicator();
  let fullResponse = '';

  try {
    let response = null;
    let lastErr = null;

    for (const model of GEMINI_MODELS) {
      try {
        const res = await fetch(getGeminiUrl(model, apiKey), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(requestBody)
        });

        if (res.ok) {
          response = res;
          break;
        } else {
          const errData = await res.json().catch(() => ({}));
          lastErr = errData?.error?.message || `API error ${res.status}`;
          // If model-specific error or 404, try next model
          if (res.status === 404 || res.status === 400) {
            continue;
          } else {
            throw new Error(lastErr);
          }
        }
      } catch (err) {
        lastErr = err.message;
        if (model === GEMINI_MODELS[GEMINI_MODELS.length - 1]) throw err;
      }
    }

    if (!response || !response.ok) {
      throw new Error(lastErr || 'Failed to connect to Gemini API. Please check your API key in Settings.');
    }

    // Remove typing dots and create the response bubble
    removeTypingIndicator();
    const bubble = appendMessage('assistant', '');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE events
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullResponse += text;
            bubble.innerHTML = renderMarkdown(fullResponse);
            scrollToBottom();
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    // Final render pass
    bubble.innerHTML = renderMarkdown(fullResponse);
    scrollToBottom();

    if (speakBtn) {
      speakBtn.classList.add('active');
      speakBtn.title = 'Stop speaking';
    }
    speakText(fullResponse);

    // Update conversation history for context
    conversationHistory.push({ role: 'model', parts: [{ text: fullResponse }] });

    // Persist to DB
    saveMessage('assistant', fullResponse, currentMode);

  } catch (error) {
    removeTypingIndicator();
    if (speakBtn) {
      speakBtn.classList.remove('active');
      speakBtn.title = 'Listen to response';
    }
    appendMessage('assistant', `❌ **Error:** ${escapeHTML(error.message)}\n\nPlease check your API key in Settings and try again.`);
    console.error('Gemini API error:', error);
    // Remove the failed user message from context
    conversationHistory.pop();
  } finally {
    isStreaming = false;
    updateSendButton();
  }
}

// ═══════════════════════════════════════════════════════════════════
// EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════════

// ─── Send Message ──────────────────────────────────────────────────
async function handleSend() {
  const text = chatInput.value.trim();
  const attachments = [...selectedFiles];

  if ((!text && !attachments.length) || isStreaming) return;

  const finalText = text || 'Please answer this question using the uploaded file(s).';
  const attachmentSummary = attachments.length
    ? `\n\n📎 Sent file${attachments.length > 1 ? 's' : ''}: ${attachments.map((file) => file.name).join(', ')}`
    : '';
  const chatText = `${finalText}${attachmentSummary}`;

  chatInput.value = '';
  selectedFiles = [];
  renderAttachmentChips();
  chatInput.style.height = 'auto';
  updateSendButton();

  appendMessage('user', chatText);
  saveMessage('user', chatText, currentMode);

  await sendToGemini(finalText, attachments);
}

sendBtn.addEventListener('click', handleSend);

uploadBtn.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', (event) => {
  const validFiles = validateSelectedFiles(event.target.files);
  if (!validFiles.length) {
    fileInput.value = '';
    return;
  }

  selectedFiles = [...selectedFiles, ...validFiles];
  renderAttachmentChips();
  updateSendButton();
  fileInput.value = '';
});

speakBtn.addEventListener('click', () => {
  if (speakBtn.classList.contains('active')) {
    window.speechSynthesis.cancel();
    speakBtn.classList.remove('active');
    speakBtn.title = 'Listen to response';
    return;
  }

  const latestAssistantReply = conversationHistory
    .slice()
    .reverse()
    .find((entry) => entry.role === 'model')?.parts?.[0]?.text;

  if (latestAssistantReply) {
    speakBtn.classList.add('active');
    speakBtn.title = 'Stop speaking';
    speakText(latestAssistantReply);
  } else {
    alert('There is no generated response to listen to yet.');
  }
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  updateSendButton();
});

// ─── Sidebar Toggle ────────────────────────────────────────────────
sidebarToggle.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  mainEl.classList.toggle('sidebar-collapsed');
});

// ─── Mode Selector ─────────────────────────────────────────────────
modeBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  modeDropdown.classList.toggle('open');
});

$$('.mode-option').forEach((opt) => {
  opt.addEventListener('click', () => {
    currentMode = opt.dataset.mode;
    modeLabel.textContent = modeDisplayName(currentMode);

    // Update active state
    $$('.mode-option').forEach((o) => o.classList.remove('active'));
    opt.classList.add('active');

    // Update dot color
    const dotColors = {
      explain: 'var(--explain-color)',
      quiz: 'var(--quiz-color)',
      revision: 'var(--revision-color)',
      code: 'var(--code-color)'
    };
    $('.mode-dot').style.background = dotColors[currentMode];

    modeDropdown.classList.remove('open');
  });
});

// Close dropdown on outside click
document.addEventListener('click', () => {
  modeDropdown.classList.remove('open');
});

// ─── Prompt Cards ──────────────────────────────────────────────────
$$('.prompt-card').forEach((card) => {
  card.addEventListener('click', () => {
    const prompt = card.dataset.prompt;
    const mode = card.dataset.mode;

    // Set mode
    currentMode = mode;
    modeLabel.textContent = modeDisplayName(mode);
    $$('.mode-option').forEach((o) => {
      o.classList.toggle('active', o.dataset.mode === mode);
    });

    const dotColors = {
      explain: 'var(--explain-color)',
      quiz: 'var(--quiz-color)',
      revision: 'var(--revision-color)',
      code: 'var(--code-color)'
    };
    $('.mode-dot').style.background = dotColors[mode];

    chatInput.value = prompt;
    chatInput.dispatchEvent(new Event('input'));
    handleSend();
  });
});

// ─── About GDG ─────────────────────────────────────────────────────
aboutGdgBtn.addEventListener('click', () => {
  aboutGdgModal.classList.remove('hidden');
});

closeAboutGdg.addEventListener('click', () => {
  aboutGdgModal.classList.add('hidden');
});

aboutGdgModal.addEventListener('click', (e) => {
  if (e.target === aboutGdgModal) aboutGdgModal.classList.add('hidden');
});

// ─── Clear History ─────────────────────────────────────────────────
clearHistBtn.addEventListener('click', () => {
  if (confirm('Clear all chat history? This cannot be undone.')) {
    clearMessages();
    showEmptyState();
  }
});

// ─── Settings ──────────────────────────────────────────────────────
function openSettings() {
  apiKeyInput.value = getApiKey();
  userNameInput.value = getUserName();
  updateKeyValidationHint();
  settingsModal.classList.remove('hidden');
  apiKeyInput.focus();
}

if (settingsBtn) {
  settingsBtn.addEventListener('click', openSettings);
}
if (topbarApiBtn) {
  topbarApiBtn.addEventListener('click', openSettings);
}

closeSettings.addEventListener('click', () => {
  settingsModal.classList.add('hidden');
});

function updateKeyValidationHint() {
  const val = apiKeyInput.value.trim();
  const hint = $('#key-validation-hint');
  if (!hint) return;
  if (val.startsWith('AQ.') || val.startsWith('AIza')) {
    hint.innerHTML = '<span style="color: #10b981; font-weight: 600;">✓ Valid Google Gemini API Key detected!</span>';
  } else if (val.length > 20) {
    hint.innerHTML = '<span style="color: #10b981; font-weight: 600;">✓ Key entered.</span>';
  } else if (val) {
    hint.innerHTML = '<span style="color: #f59e0b;">Key should start with <code>AQ.</code> or <code>AIzaSy</code>.</span>';
  } else {
    hint.innerHTML = 'Paste your Google Gemini API key here. Stored locally in your browser.';
  }
}

apiKeyInput.addEventListener('input', updateKeyValidationHint);

saveSettings.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  const name = userNameInput.value.trim();
  if (key) localStorage.setItem('sb_api_key', key);
  if (name) localStorage.setItem('sb_user_name', name);
  else localStorage.removeItem('sb_user_name');
  updateGreeting();
  settingsModal.classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════════
async function boot() {
  updateGreeting();
  renderAttachmentChips();
  updateSendButton();

  try {
    await initDB();
  } catch (e) {
    console.error('Failed to initialize sql.js database:', e);
  }

  // Restore past messages from DB
  const history = loadMessages();
  if (history.length > 0) {
    history.forEach(({ role, content }) => {
      appendMessage(role, content, false);
      // Rebuild Gemini context
      conversationHistory.push({
        role: role === 'assistant' ? 'model' : 'user',
        parts: [{ text: content }]
      });
    });
  }

  // If no API key, show settings prompt after a short delay
  if (!getApiKey()) {
    setTimeout(() => {
      settingsModal.classList.remove('hidden');
    }, 800);
  }
}

boot();
