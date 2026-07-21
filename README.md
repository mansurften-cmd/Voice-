# Voice Journal

Record a spoken journal entry, get it transcribed live in the browser, and let DeepSeek judge it:

- **Category**: Work / Pleasure / What Went Wrong
- **Mood**: Sad / Not Feeling Good / Medium / Good / Best
- **Irritation**: Irritated / Not Irritated
- **Anger score**: 1-10 (10 = most angry)

The judgment factors in both the transcript text and simple vocal delivery metrics captured while recording (speaking pace, average/peak volume). Entries are saved to a **Voice Journal** database in your Notion workspace.

## 1. Prerequisites

- Node.js 18+ (uses the built-in `fetch`)
- A DeepSeek API key: https://platform.deepseek.com
- A Notion integration token:
  1. Go to https://www.notion.so/my-integrations and create a new internal integration.
  2. Copy its "Internal Integration Secret" — this is your `NOTION_TOKEN`.
  3. Open the **Voice Journal** database in Notion (already created for you), click `···` in the top right → **Connections** → connect your new integration. Without this step, the API calls will fail with a 404/403.

## 2. Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

```
DEEPSEEK_API_KEY=sk-...
NOTION_TOKEN=ntn_...
NOTION_DATABASE_ID=9f059cf5-b09b-435e-941e-3283055e6b7d
NOTION_DATA_SOURCE_ID=582f8887-d711-4115-9b62-5d613cbdeec5
APP_USERNAME=journal
APP_PASSWORD=pick-something-only-you-know
PORT=3000
```

`NOTION_DATABASE_ID` and `NOTION_DATA_SOURCE_ID` already point at the **Voice Journal** database created for this project — leave them as-is unless you moved/recreated the database.

`APP_USERNAME`/`APP_PASSWORD` gate the whole app behind a browser login prompt (HTTP Basic Auth). Leave `APP_PASSWORD` blank for local dev if you don't want to be prompted; **always set it when deploying publicly** (see below), or anyone with the URL can create entries and spend your API credits.

## 3. Run

```bash
npm start
```

Open http://localhost:3000 in **Chrome or Edge** (Web Speech API live transcription is not supported in Firefox/Safari — you can still type the transcript manually there).

## 4. Use it

1. Click **Start Recording**, allow microphone access, and talk.
2. Click **Stop Recording** — the transcript, duration, word count, pace, and volume metrics are captured.
3. Edit the transcript if needed, then click **Analyze**.
4. Review the judgment (category, mood, irritation, anger score, reasoning).
5. Click **Save to Notion** to log the entry.

## 5. Deploy it on the internet (Render, free tier)

1. Push this repo to GitHub (already done if you're reading this from the repo).
2. Go to https://render.com, sign up/log in, and click **New +** → **Web Service**.
3. Connect your GitHub account and select this repo (`Voice-`), branch `claude/voice-journal-mood-tracker-xp825o` (or `main` once merged).
4. Render should auto-detect the `render.yaml` blueprint in this repo. If it asks to use it, accept — it pre-fills:
   - Build command: `npm install`
   - Start command: `npm start`
   - Plan: Free
5. When prompted, fill in the env vars Render leaves blank (`sync: false` in `render.yaml`):
   - `DEEPSEEK_API_KEY`
   - `NOTION_TOKEN`
   - `APP_USERNAME` (pick anything, e.g. `journal`)
   - `APP_PASSWORD` (**required for a public deployment** — pick something only you know)
6. Click **Create Web Service**. First deploy takes a couple of minutes.
7. Once live, Render gives you a URL like `https://voice-journal-xxxx.onrender.com`. Open it — your browser will prompt for the username/password you set, then the app works exactly like local, over HTTPS (required for microphone access on a non-localhost domain).

**Free tier note**: Render's free web services spin down after ~15 minutes of inactivity and take 30-60 seconds to wake up on the next request — normal for personal-use apps, not a bug.

## How it works

- **Transcription**: browser-native Web Speech API (`SpeechRecognition`), free and runs client-side while you talk.
- **Vocal metrics**: a `Web Audio API` `AnalyserNode` samples microphone volume during recording to compute average/peak volume, alongside duration and words-per-minute — passed to the model as delivery cues in addition to the words themselves.
- **Judgment**: the transcript + vocal metrics are sent to DeepSeek (`deepseek-chat`, JSON output mode) with a prompt asking it to classify category, mood, irritation, and an anger score 1-10 with reasoning.
- **Storage**: saved entries are created as pages in your Notion **Voice Journal** database via the Notion API.

## Notes

- Audio itself is not uploaded or stored anywhere — only the transcript and computed metrics leave the browser.
- The DeepSeek and Notion API keys are only ever used server-side (`server.js`), never exposed to the browser.
