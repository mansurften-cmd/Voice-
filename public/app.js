const recordBtn = document.getElementById('recordBtn');
const timerEl = document.getElementById('timer');
const transcriptEl = document.getElementById('transcript');
const recordHint = document.getElementById('recordHint');
const metricsEl = document.getElementById('metrics');
const analyzeBtn = document.getElementById('analyzeBtn');
const resetBtn = document.getElementById('resetBtn');
const analyzeStatus = document.getElementById('analyzeStatus');
const resultsCard = document.getElementById('resultsCard');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const historyCard = document.getElementById('historyCard');
const historyList = document.getElementById('historyList');

let recognizing = false;
let recognition = null;
let finalTranscript = '';
let audioContext, analyser, micSource, micStream, volumeInterval;
let volumeSum = 0, volumeSamples = 0, volumePeak = 0;
let startTime = null, timerInterval = null;
let lastAnalysis = null;

const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SpeechRecognitionImpl) {
  recordHint.textContent = 'Live transcription is not supported in this browser. Try Chrome or Edge, or type your entry manually below.';
}

function formatTimer(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function setupRecognition() {
  const rec = new SpeechRecognitionImpl();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = 'en-US';

  rec.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += text + ' ';
      } else {
        interim += text;
      }
    }
    transcriptEl.value = (finalTranscript + interim).trim();
  };

  rec.onerror = (event) => {
    if (event.error !== 'no-speech') {
      recordHint.textContent = `Speech recognition error: ${event.error}. You can still type/edit the transcript manually.`;
    }
  };

  rec.onend = () => {
    if (recognizing) {
      try { rec.start(); } catch { /* already starting */ }
    }
  };

  return rec;
}

async function startVolumeTracking(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  micSource = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  micSource.connect(analyser);

  const data = new Uint8Array(analyser.fftSize);
  volumeSum = 0;
  volumeSamples = 0;
  volumePeak = 0;

  volumeInterval = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const level = Math.min(100, Math.round(rms * 200));
    volumeSum += level;
    volumeSamples += 1;
    if (level > volumePeak) volumePeak = level;
  }, 200);
}

function stopVolumeTracking() {
  if (volumeInterval) clearInterval(volumeInterval);
  if (micSource) micSource.disconnect();
  if (audioContext) audioContext.close();
  volumeInterval = null;
}

async function startRecording() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recordHint.textContent = 'Microphone access was denied. Please allow microphone access and try again.';
    return;
  }

  finalTranscript = '';
  transcriptEl.value = '';
  resultsCard.hidden = true;
  analyzeStatus.textContent = '';
  saveStatus.textContent = '';

  await startVolumeTracking(micStream);

  if (SpeechRecognitionImpl) {
    recognition = setupRecognition();
    recognizing = true;
    recognition.start();
  }

  startTime = Date.now();
  timerInterval = setInterval(() => {
    timerEl.textContent = formatTimer(Date.now() - startTime);
  }, 250);

  recordBtn.classList.add('recording');
  recordBtn.innerHTML = '<span class="dot"></span> Stop Recording';
  analyzeBtn.disabled = true;
}

function stopRecording() {
  recognizing = false;
  if (recognition) {
    try { recognition.stop(); } catch { /* ignore */ }
  }
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
  }
  stopVolumeTracking();
  clearInterval(timerInterval);

  recordBtn.classList.remove('recording');
  recordBtn.innerHTML = '<span class="dot"></span> Start Recording';

  const durationSeconds = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
  const wordCount = transcriptEl.value.trim() ? transcriptEl.value.trim().split(/\s+/).length : 0;
  const speakingRateWpm = durationSeconds > 0 ? Math.round((wordCount / durationSeconds) * 60) : 0;
  const avgVolume = volumeSamples > 0 ? Math.round(volumeSum / volumeSamples) : 0;

  window.__voiceMetrics = {
    durationSeconds,
    wordCount,
    speakingRateWpm,
    avgVolume,
    peakVolume: volumePeak,
  };

  document.getElementById('mDuration').textContent = `${durationSeconds}s`;
  document.getElementById('mWords').textContent = wordCount;
  document.getElementById('mPace').textContent = speakingRateWpm;
  document.getElementById('mAvgVol').textContent = avgVolume;
  document.getElementById('mPeakVol').textContent = volumePeak;
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
  analyzeBtn.disabled = !transcriptEl.value.trim();
});

resetBtn.addEventListener('click', () => {
  transcriptEl.value = '';
  finalTranscript = '';
  metricsEl.hidden = true;
  resultsCard.hidden = true;
  analyzeStatus.textContent = '';
  saveStatus.textContent = '';
  timerEl.textContent = '00:00';
  analyzeBtn.disabled = true;
  window.__voiceMetrics = null;
});

const CATEGORY_COLORS = { Work: '#4f46e5', Pleasure: '#16a34a', 'What Went Wrong': '#dc2626' };
const MOOD_COLORS = {
  Best: '#16a34a',
  Good: '#2563eb',
  Medium: '#ca8a04',
  'Not Feeling Good': '#ea580c',
  Sad: '#dc2626',
};
const IRRITATION_COLORS = { Irritated: '#dc2626', 'Not Irritated': '#16a34a' };

function renderResults(result) {
  const badgeCategory = document.getElementById('badgeCategory');
  const badgeMood = document.getElementById('badgeMood');
  const badgeIrritation = document.getElementById('badgeIrritation');

  badgeCategory.textContent = result.category;
  badgeCategory.style.borderColor = CATEGORY_COLORS[result.category] || '#999';
  badgeCategory.style.color = CATEGORY_COLORS[result.category] || '#999';

  badgeMood.textContent = result.mood;
  badgeMood.style.borderColor = MOOD_COLORS[result.mood] || '#999';
  badgeMood.style.color = MOOD_COLORS[result.mood] || '#999';

  badgeIrritation.textContent = result.irritation;
  badgeIrritation.style.borderColor = IRRITATION_COLORS[result.irritation] || '#999';
  badgeIrritation.style.color = IRRITATION_COLORS[result.irritation] || '#999';

  document.getElementById('angerValue').textContent = result.angerScore;
  document.getElementById('angerFill').style.width = `${result.angerScore * 10}%`;
  document.getElementById('reasoning').textContent = result.reasoning || '';

  resultsCard.hidden = false;
  saveStatus.textContent = '';
}

analyzeBtn.addEventListener('click', async () => {
  const transcript = transcriptEl.value.trim();
  if (!transcript) return;

  analyzeBtn.disabled = true;
  analyzeStatus.textContent = 'Analyzing...';
  analyzeStatus.className = 'status';

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
    analyzeStatus.textContent = '';
  } catch (err) {
    analyzeStatus.textContent = err.message;
    analyzeStatus.className = 'status error';
  } finally {
    analyzeBtn.disabled = false;
  }
});

saveBtn.addEventListener('click', async () => {
  if (!lastAnalysis) return;
  saveBtn.disabled = true;
  saveStatus.textContent = 'Saving to Notion...';
  saveStatus.className = 'status';

  try {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcriptEl.value.trim(),
        ...lastAnalysis,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');

    saveStatus.textContent = 'Saved to Notion.';
    saveStatus.className = 'status success';
    addHistoryEntry(lastAnalysis, data.url);
  } catch (err) {
    saveStatus.textContent = err.message;
    saveStatus.className = 'status error';
  } finally {
    saveBtn.disabled = false;
  }
});

function addHistoryEntry(result, url) {
  historyCard.hidden = false;
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<a href="${url}" target="_blank" rel="noopener">${result.category} · ${result.mood} · ${result.irritation} · anger ${result.angerScore}/10</a>
    <div class="meta">${time}</div>`;
  historyList.prepend(li);
}
