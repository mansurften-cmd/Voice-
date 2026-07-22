/* ---------- Elements ---------- */
const recordBtn = document.getElementById('recordBtn');
const timerEl = document.getElementById('timer');
const transcriptEl = document.getElementById('transcript');
const recordHint = document.getElementById('recordHint');
const listeningEl = document.getElementById('listening');
const wordCountEl = document.getElementById('wordCount');
const metricsEl = document.getElementById('metrics');
const analyzeBtn = document.getElementById('analyzeBtn');
const resetBtn = document.getElementById('resetBtn');
const resultsCard = document.getElementById('resultsCard');
const saveBtn = document.getElementById('saveBtn');
const historyCard = document.getElementById('historyCard');
const historyList = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const themeToggle = document.getElementById('themeToggle');

let recognizing = false;
let recognition = null;
let finalTranscript = '';
let startTime = null, timerInterval = null;
let lastAnalysis = null;

/* ---------- Lookups ---------- */
const MOOD_EMOJI = {
  Best: '🤩', Good: '🙂', Medium: '😐', 'Not Feeling Good': '😟', Sad: '😢',
};
const CATEGORY_EMOJI = { Work: '💼', Pleasure: '🌿', 'What Went Wrong': '⚠️' };
const IRRITATION_EMOJI = { Irritated: '😤', 'Not Irritated': '😌' };

/* ---------- Helpers ---------- */
function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function countWords(text) {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function updateWordCount() {
  const n = countWords(transcriptEl.value);
  wordCountEl.textContent = `${n} ${n === 1 ? 'word' : 'words'}`;
}

function setLoading(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

function toast(message, type) {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ` ${type}` : '');
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

/* ---------- Speech recognition (verified — do not alter dedup logic) ---------- */
const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognitionImpl) {
  recordHint.textContent = 'Live transcription is not supported in this browser. Try Chrome or Edge, or just type your entry.';
}

function setupRecognition() {
  const rec = new SpeechRecognitionImpl();
  // continuous mode is unreliable on Android Chrome — it can re-emit the same
  // speech as overlapping final segments. Single-utterance sessions, manually
  // re-chained on 'onend', avoid that while still feeling continuous.
  rec.continuous = false;
  rec.interimResults = true;
  rec.lang = 'en-US';

  // Text this session has finalized so far. Committed to finalTranscript on 'onend'.
  let sessionFinal = '';

  rec.onresult = (event) => {
    // event.results is cumulative for this session, so rebuild from scratch each
    // time rather than appending. Collapse consecutive identical final segments —
    // Android Chrome sometimes reports the same utterance at multiple result
    // indices, which an index-based guard cannot catch.
    let finalText = '';
    let interim = '';
    let prevSeg = null;
    for (let i = 0; i < event.results.length; i++) {
      const result = event.results[i];
      const seg = result[0].transcript;
      if (result.isFinal) {
        const norm = seg.trim();
        if (norm && norm !== prevSeg) {
          finalText += norm + ' ';
          prevSeg = norm;
        }
      } else {
        interim += seg;
      }
    }
    sessionFinal = finalText;
    transcriptEl.value = (finalTranscript + finalText + interim).trim();
    updateWordCount();
  };

  rec.onerror = (event) => {
    if (event.error === 'not-allowed' || event.error === 'audio-capture') {
      recordHint.textContent = event.error === 'not-allowed'
        ? 'Microphone access was denied. Allow microphone access in your browser settings and try again.'
        : 'No microphone could be reached for speech recognition. Check your mic and try again.';
      stopRecording();
    } else if (event.error !== 'no-speech') {
      recordHint.textContent = `Speech recognition error: ${event.error}. You can still type/edit the transcript manually.`;
    }
  };

  rec.onend = () => {
    // Ignore late 'end' events from an already-superseded instance so its text
    // isn't committed twice and it can't spawn a second listener.
    if (recognition !== rec) return;
    finalTranscript += sessionFinal;
    // Re-chain a fresh single-utterance session so listening feels continuous.
    if (recognizing) {
      recognition = setupRecognition();
      try { recognition.start(); } catch { /* already starting */ }
    }
  };

  return rec;
}

function startRecording() {
  finalTranscript = '';
  transcriptEl.value = '';
  updateWordCount();
  resultsCard.hidden = true;

  if (SpeechRecognitionImpl) {
    recordHint.textContent = 'Listening… allow microphone access if your browser asks.';
    recognition = setupRecognition();
    recognizing = true;
    try {
      recognition.start();
    } catch {
      /* ignore duplicate start */
    }
  } else {
    recordHint.textContent = 'Live transcription is not supported in this browser. Type your entry below.';
  }

  startTime = Date.now();
  timerInterval = setInterval(() => {
    timerEl.textContent = formatTimer(Date.now() - startTime);
  }, 250);

  recordBtn.classList.add('recording');
  recordBtn.setAttribute('aria-label', 'Stop recording');
  listeningEl.hidden = false;
  analyzeBtn.disabled = true;
}

function stopRecording() {
  recognizing = false;
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
  clearInterval(timerInterval);

  recordBtn.classList.remove('recording');
  recordBtn.setAttribute('aria-label', 'Start recording');
  listeningEl.hidden = true;
  recordHint.textContent = transcriptEl.value.trim()
    ? 'Edit if needed, then analyze your mood.'
    : 'Tap the mic and start talking. You can edit the text after.';

  const durationSeconds = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
  const wordCount = countWords(transcriptEl.value);
  const speakingRateWpm = durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;

  window.__voiceMetrics = { durationSeconds, wordCount, speakingRateWpm };

  document.getElementById('mDuration').textContent = `${durationSeconds}s`;
  document.getElementById('mWords').textContent = wordCount;
  document.getElementById('mPace').textContent = speakingRateWpm;
  metricsEl.hidden = false;

  analyzeBtn.disabled = !transcriptEl.value.trim();
}

recordBtn.addEventListener('click', () => {
  if (recordBtn.classList.contains('recording')) {
    stopRecording();
  } else {
    startRecording();
  }
});

transcriptEl.addEventListener('input', () => {
  updateWordCount();
  analyzeBtn.disabled = !transcriptEl.value.trim();
});

resetBtn.addEventListener('click', () => {
  if (recognizing) stopRecording();
  transcriptEl.value = '';
  finalTranscript = '';
  updateWordCount();
  metricsEl.hidden = true;
  resultsCard.hidden = true;
  timerEl.textContent = '00:00';
  analyzeBtn.disabled = true;
  window.__voiceMetrics = null;
  recordHint.textContent = 'Tap the mic and start talking. You can edit the text after.';
});

/* ---------- Results rendering ---------- */
function segColor(pos) {
  if (pos <= 3) return '#17a673';
  if (pos <= 5) return '#eab308';
  if (pos <= 7) return '#f97316';
  return '#e2374a';
}

function renderGauge(score) {
  const gauge = document.getElementById('angerGauge');
  gauge.innerHTML = '';
  gauge.setAttribute('aria-label', `Anger level ${score} of 10`);
  for (let i = 1; i <= 10; i++) {
    const seg = document.createElement('span');
    if (i <= score) {
      seg.className = 'on';
      seg.style.background = segColor(i);
    }
    gauge.appendChild(seg);
  }
}

function renderResults(result) {
  document.getElementById('resTitle').textContent = result.title || 'Your reflection';

  document.getElementById('moodEmoji').textContent = MOOD_EMOJI[result.mood] || '😐';
  document.getElementById('moodLabel').textContent = result.mood;

  const chipCat = document.getElementById('chipCategory');
  chipCat.querySelector('.chip-emoji').textContent = CATEGORY_EMOJI[result.category] || '📝';
  chipCat.querySelector('span:last-child').textContent = result.category;

  const chipIrr = document.getElementById('chipIrritation');
  chipIrr.querySelector('.chip-emoji').textContent = IRRITATION_EMOJI[result.irritation] || '😌';
  chipIrr.querySelector('span:last-child').textContent = result.irritation;

  document.getElementById('angerValue').textContent = result.angerScore;
  renderGauge(result.angerScore);

  document.getElementById('reasoning').textContent = result.reasoning || '';

  resultsCard.hidden = false;
  resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

analyzeBtn.addEventListener('click', async () => {
  const transcript = transcriptEl.value.trim();
  if (!transcript) return;

  setLoading(analyzeBtn, true);
  try {
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, voiceMetrics: window.__voiceMetrics || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    lastAnalysis = data;
    renderResults(data);
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(analyzeBtn, false);
  }
});

saveBtn.addEventListener('click', async () => {
  if (!lastAnalysis) return;
  setLoading(saveBtn, true);
  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: transcriptEl.value.trim(), ...lastAnalysis }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    toast('Saved to Notion ✓', 'ok');
    addHistoryEntry({ ...lastAnalysis, url: data.url, ts: Date.now() });
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    setLoading(saveBtn, false);
  }
});

/* ---------- History (persisted in localStorage) ---------- */
const HISTORY_KEY = 'vj_history';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
}
function saveHistory(items) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20))); } catch { /* ignore quota */ }
}

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function historyItemNode(item) {
  const node = document.createElement(item.url ? 'a' : 'div');
  node.className = 'history-item';
  if (item.url) { node.href = item.url; node.target = '_blank'; node.rel = 'noopener'; }
  const title = item.title || 'Journal entry';
  node.innerHTML = `
    <span class="history-emoji">${MOOD_EMOJI[item.mood] || '😐'}</span>
    <span class="history-main">
      <span class="history-title"></span>
      <span class="history-sub">${item.category} · anger ${item.angerScore}/10 · ${relativeTime(item.ts)}</span>
    </span>
    <span class="history-arrow" aria-hidden="true">↗</span>`;
  node.querySelector('.history-title').textContent = title;
  if (!item.url) node.querySelector('.history-arrow').remove();
  return node;
}

function renderHistory() {
  const items = loadHistory();
  historyCard.hidden = items.length === 0;
  historyList.innerHTML = '';
  items.forEach((item) => historyList.appendChild(historyItemNode(item)));
}

function addHistoryEntry(item) {
  const items = loadHistory();
  items.unshift(item);
  saveHistory(items);
  renderHistory();
}

clearHistoryBtn.addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

/* ---------- Theme ---------- */
function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
function currentTheme() {
  const saved = localStorage.getItem('vj_theme');
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
applyTheme(localStorage.getItem('vj_theme'));
themeToggle.addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  localStorage.setItem('vj_theme', next);
  applyTheme(next);
});

/* ---------- Init ---------- */
updateWordCount();
renderHistory();
