require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();

const APP_USERNAME = process.env.APP_USERNAME || 'journal';
const APP_PASSWORD = process.env.APP_PASSWORD;

if (APP_PASSWORD) {
  app.use((req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      const userBuf = Buffer.from(user || '');
      const passBuf = Buffer.from(pass || '');
      const expectedUserBuf = Buffer.from(APP_USERNAME);
      const expectedPassBuf = Buffer.from(APP_PASSWORD);
      const userOk = userBuf.length === expectedUserBuf.length && crypto.timingSafeEqual(userBuf, expectedUserBuf);
      const passOk = passBuf.length === expectedPassBuf.length && crypto.timingSafeEqual(passBuf, expectedPassBuf);
      if (userOk && passOk) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Voice Journal"');
    res.status(401).send('Authentication required');
  });
} else {
  console.warn('APP_PASSWORD is not set — the app is running without a password gate.');
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

const MOODS = ['Sad', 'Not Feeling Good', 'Medium', 'Good', 'Best'];
const CATEGORIES = ['Work', 'Pleasure', 'What Went Wrong'];
const IRRITATION = ['Irritated', 'Not Irritated'];

function buildAnalysisPrompt(transcript, voiceMetrics) {
  const { durationSeconds, wordCount, speakingRateWpm, avgVolume, peakVolume } = voiceMetrics || {};

  return `You are a journaling assistant that judges a spoken voice-journal entry using BOTH the words said and how it was said (vocal delivery metrics captured while recording).

Transcript:
"""
${transcript}
"""

Vocal delivery metrics captured during recording (0-100 scale for volume, unless noted):
- Duration: ${durationSeconds ?? 'unknown'} seconds
- Word count: ${wordCount ?? 'unknown'}
- Speaking rate: ${speakingRateWpm ?? 'unknown'} words per minute (fast/rushed speech and raised volume often signal irritation or anger; slow, low-volume, flat delivery often signals sadness or low mood)
- Average volume: ${avgVolume ?? 'unknown'}
- Peak volume: ${peakVolume ?? 'unknown'}

Classify this entry and respond with ONLY a JSON object (no markdown, no commentary) with exactly these fields:
{
  "category": one of ${JSON.stringify(CATEGORIES)} (pick the single best fit — "What Went Wrong" is for entries mainly about a problem/complaint/mistake, even if it happened at work or during leisure),
  "mood": one of ${JSON.stringify(MOODS)},
  "irritation": one of ${JSON.stringify(IRRITATION)},
  "angerScore": integer from 1 to 10, where 10 is the most angry/furious and 1 is completely calm,
  "reasoning": a short (1-2 sentence) explanation citing both what was said and how it was said
}`;
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { transcript, voiceMetrics } = req.body || {};
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: 'transcript is required' });
    }
    if (!DEEPSEEK_API_KEY) {
      return res.status(500).json({ error: 'DEEPSEEK_API_KEY is not configured on the server' });
    }

    const prompt = buildAnalysisPrompt(transcript, voiceMetrics);

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: `DeepSeek API error: ${response.status} ${errText}` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'DeepSeek returned non-JSON output', raw });
    }

    if (!CATEGORIES.includes(parsed.category)) parsed.category = 'Work';
    if (!MOODS.includes(parsed.mood)) parsed.mood = 'Medium';
    if (!IRRITATION.includes(parsed.irritation)) parsed.irritation = 'Not Irritated';
    const score = Number(parsed.angerScore);
    parsed.angerScore = Number.isFinite(score) ? Math.min(10, Math.max(1, Math.round(score))) : 1;

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save', async (req, res) => {
  try {
    const { transcript, category, mood, irritation, angerScore, reasoning, title } = req.body || {};
    if (!transcript) return res.status(400).json({ error: 'transcript is required' });
    if (!NOTION_TOKEN) return res.status(500).json({ error: 'NOTION_TOKEN is not configured on the server' });

    const parentId = NOTION_DATA_SOURCE_ID || NOTION_DATABASE_ID;
    if (!parentId) return res.status(500).json({ error: 'NOTION_DATA_SOURCE_ID or NOTION_DATABASE_ID must be configured' });

    const parent = NOTION_DATA_SOURCE_ID
      ? { type: 'data_source_id', data_source_id: NOTION_DATA_SOURCE_ID }
      : { type: 'database_id', database_id: NOTION_DATABASE_ID };

    const entryTitle = (title && title.trim()) || transcript.trim().slice(0, 60) || 'Voice Journal Entry';

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2025-09-03',
      },
      body: JSON.stringify({
        parent,
        properties: {
          Entry: { title: [{ text: { content: entryTitle } }] },
          Date: { date: { start: new Date().toISOString() } },
          Transcript: { rich_text: [{ text: { content: transcript.slice(0, 2000) } }] },
          Category: { select: { name: category } },
          Mood: { select: { name: mood } },
          Irritation: { select: { name: irritation } },
          'Anger Score': { number: angerScore },
          Reasoning: { rich_text: [{ text: { content: (reasoning || '').slice(0, 2000) } }] },
        },
      }),
    });

    if (!notionRes.ok) {
      const errText = await notionRes.text();
      return res.status(502).json({ error: `Notion API error: ${notionRes.status} ${errText}` });
    }

    const page = await notionRes.json();
    res.json({ ok: true, url: page.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Voice Journal running at http://localhost:${PORT}`);
});
