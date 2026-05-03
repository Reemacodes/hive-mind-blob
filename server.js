require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
const path = require('path');
const os = require('os');

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const client = new Anthropic();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default blob state
let state = {
  hue: 200, saturation: 0.45, brightness: 0.55,
  speed: 0.1, complexity: 0.15, size: 0.3, chaos: 0.05,
  label: '', rainbow: false, promptCount: 0
};

const IDLE_STATE = {
  hue: 200, saturation: 0.45, brightness: 0.55,
  speed: 0.15, complexity: 0.2, size: 0.5, chaos: 0.08
};
const IDLE_TIMEOUT_MS = 15000;
let lastPromptTime = Date.now();
let frozen = false;

// Gradually drift back to calm when idle
setInterval(() => {
  if (frozen) return;
  if (Date.now() - lastPromptTime < IDLE_TIMEOUT_MS) return;
  const DRIFT = 0.04;
  let changed = false;
  for (const k of Object.keys(IDLE_STATE)) {
    const diff = IDLE_STATE[k] - state[k];
    if (Math.abs(diff) > 0.005) {
      state[k] = state[k] + diff * DRIFT;
      changed = true;
    }
  }
  if (state.rainbow) { state.rainbow = false; changed = true; }
  if (changed) io.emit('state', state);
}, 500);

const SYSTEM_PROMPT = `You are a visual parameter interpreter for a live generative art installation called the Hive Mind Blob.

Given a short text prompt, return ONLY valid JSON — no explanation, no markdown, no code fences.

CRITICAL — COLOR NAMES: when the input contains a color word, you MUST use the exact hue listed below. This overrides all other considerations.

red → hue 0 | orange → hue 28 | yellow → hue 58 | gold → hue 48 | lime → hue 88
GREEN → hue 125 | teal → hue 168 | cyan → hue 188 | sky blue → hue 200
blue → hue 218 | navy → hue 228 | indigo → hue 248 | purple → hue 272 | violet → hue 268
magenta → hue 300 | pink → hue 338 | rose → hue 345 | crimson → hue 355
white → hue 0, saturation 0.0, brightness 1.0
black → hue 0, saturation 0.0, brightness 0.05

COLOR MIXING — two or more color names → blend hues along the shortest arc:
"red and yellow" → hue 29 | "red and blue" → hue 289 | "blue and green" → hue 172
"yellow and blue" → hue 143 | "red and green" → hue 62 | "pink and purple" → hue 305

Schema:
{
  "hue": <0-360>,
  "saturation": <0.0-1.0>,
  "brightness": <0.0-1.0>,
  "speed": <0.0-1.0>,
  "complexity": <0.0-1.0>,
  "size": <0.5-1.5>,
  "chaos": <0.0-1.0>,
  "rainbow": <true or false>,
  "label": "<1-3 word label>"
}

Rules:
- EVERY word must produce a strong visual response — no generic fallback
- "rainbow" → rainbow: true, high saturation, vivid brightness
- Animals, objects, places → use their strongest color association (grass → green hue 125, sun → yellow hue 58, ocean → blue hue 210, blood → red hue 0, snow → white)
- Emotions → push ALL parameters to extremes. The blob must feel radically different for each word.
- Physical sensations (cold, hot, sharp, heavy) → translate to color + motion + chaos
- Nonsense or made-up words → interpret phonetically (sharp sounds → high chaos, soft sounds → smooth/slow)

Examples:
- "happy"          → {"hue":52,"saturation":0.85,"brightness":0.98,"speed":0.5,"complexity":0.35,"size":1.05,"chaos":0.08,"rainbow":false,"label":"happy"}
- "angry"          → {"hue":3,"saturation":1.0,"brightness":0.5,"speed":0.95,"complexity":0.95,"size":1.45,"chaos":0.98,"rainbow":false,"label":"angry"}
- "excited"        → {"hue":182,"saturation":1.0,"brightness":1.0,"speed":0.92,"complexity":0.65,"size":1.2,"chaos":0.48,"rainbow":false,"label":"excited"}
- "anxious"        → {"hue":22,"saturation":0.9,"brightness":0.65,"speed":0.88,"complexity":0.95,"size":1.1,"chaos":0.88,"rainbow":false,"label":"anxious"}
- "sad"            → {"hue":220,"saturation":0.2,"brightness":0.15,"speed":0.05,"complexity":0.15,"size":0.7,"chaos":0.02,"rainbow":false,"label":"sad"}
- "calm"           → {"hue":195,"saturation":0.5,"brightness":0.85,"speed":0.08,"complexity":0.1,"size":1.0,"chaos":0.02,"rainbow":false,"label":"calm"}
- "rage"           → {"hue":0,"saturation":1.0,"brightness":0.45,"speed":1.0,"complexity":1.0,"size":1.5,"chaos":1.0,"rainbow":false,"label":"rage"}
- "joyful"         → {"hue":52,"saturation":1.0,"brightness":1.0,"speed":0.7,"complexity":0.5,"size":1.1,"chaos":0.1,"rainbow":false,"label":"joyful"}
- "rainbow"        → {"hue":0,"saturation":1.0,"brightness":0.9,"speed":0.5,"complexity":0.6,"size":1.1,"chaos":0.3,"rainbow":true,"label":"rainbow"}
- "dog"            → {"hue":35,"saturation":0.7,"brightness":0.75,"speed":0.7,"complexity":0.5,"size":1.1,"chaos":0.45,"rainbow":false,"label":"good dog"}
- "ocean"          → {"hue":210,"saturation":0.8,"brightness":0.7,"speed":0.3,"complexity":0.6,"size":1.2,"chaos":0.4,"rainbow":false,"label":"deep ocean"}
- "fire"           → {"hue":15,"saturation":1.0,"brightness":0.85,"speed":0.9,"complexity":0.8,"size":1.3,"chaos":0.85,"rainbow":false,"label":"fire"}
- "powerful"       → {"hue":270,"saturation":0.9,"brightness":0.4,"speed":0.4,"complexity":0.4,"size":1.5,"chaos":0.08,"rainbow":false,"label":"powerful"}
- "frozen"         → {"hue":200,"saturation":0.15,"brightness":0.5,"speed":0.0,"complexity":0.05,"size":0.85,"chaos":0.0,"rainbow":false,"label":"frozen"}
- "love"           → {"hue":330,"saturation":0.9,"brightness":0.75,"speed":0.35,"complexity":0.5,"size":1.15,"chaos":0.2,"rainbow":false,"label":"love"}
- "red and yellow" → {"hue":29,"saturation":1.0,"brightness":0.9,"speed":0.6,"complexity":0.5,"size":1.1,"chaos":0.35,"rainbow":false,"label":"red & yellow"}
- "banana"         → {"hue":56,"saturation":0.95,"brightness":0.95,"speed":0.4,"complexity":0.3,"size":0.95,"chaos":0.15,"rainbow":false,"label":"banana"}
- "midnight"       → {"hue":240,"saturation":0.6,"brightness":0.08,"speed":0.1,"complexity":0.3,"size":0.9,"chaos":0.05,"rainbow":false,"label":"midnight"}
- "explosion"      → {"hue":22,"saturation":1.0,"brightness":0.9,"speed":1.0,"complexity":1.0,"size":1.5,"chaos":1.0,"rainbow":false,"label":"explosion"}
- "forest"         → {"hue":128,"saturation":0.7,"brightness":0.45,"speed":0.2,"complexity":0.7,"size":1.1,"chaos":0.25,"rainbow":false,"label":"forest"}
- "cosmos"         → {"hue":258,"saturation":0.8,"brightness":0.25,"speed":0.25,"complexity":0.9,"size":1.3,"chaos":0.45,"rainbow":false,"label":"cosmos"}`;

function blend(current, incoming, weight = 0.9) {
  const result = {};
  const NUMERIC = ['hue','saturation','brightness','speed','complexity','size','chaos'];
  for (const key of NUMERIC) {
    result[key] = current[key] * (1 - weight) + (incoming[key] ?? current[key]) * weight;
  }
  result.label = incoming.label || current.label;
  result.rainbow = incoming.rainbow || false;
  result.promptCount = current.promptCount;
  return result;
}

// ── Queue ──────────────────────────────────────────────────────────────────────
let promptQueue = [];
let queueProcessing = false;
const DWELL_MS = 5000;
const MAX_QUEUE = 60;
const MILESTONES = new Set([10, 25, 50, 75, 100]);

async function processNext() {
  if (frozen || queueProcessing || promptQueue.length === 0) return;
  queueProcessing = true;

  const item = promptQueue.shift();
  io.emit('queue_update', { queueLength: promptQueue.length });

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: item.text }]
    });

    const raw = message.content[0].text.trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const incoming = JSON.parse(raw);

    state = blend(state, incoming);
    state.promptCount += 1;

    if (MILESTONES.has(state.promptCount)) {
      io.emit('milestone', { count: state.promptCount });
    }

    io.emit('state', state);
    io.emit('chat', {
      text: item.text,
      label: incoming.label || item.text,
      emoji: incoming.emoji || '',
      ts: Date.now()
    });
  } catch (err) {
    console.error('Queue error:', err.message);
    // Still emit chat so the item shows in the feed
    io.emit('chat', { text: item.text, label: '?', emoji: '', ts: Date.now() });
  }

  // Dwell — shorter when queue is long so everyone gets heard sooner
  const dwell = promptQueue.length > 20 ? 2000 : promptQueue.length > 10 ? 3000 : DWELL_MS;
  await new Promise(r => setTimeout(r, dwell));
  queueProcessing = false;
  processNext();
}

setInterval(processNext, 300);

// ── Rate limiting ──────────────────────────────────────────────────────────────
const lastPrompt = new Map();
const RATE_LIMIT_MS = 2500;

function getSession(req) {
  let id = req.headers['x-session-id'];
  if (!id || id.length < 8) {
    id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  return id;
}

app.post('/prompt', (req, res) => {
  const { text, sessionId } = req.body;
  const session = sessionId || getSession(req);

  if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Empty prompt' });
  if (text.length > 120) return res.status(400).json({ error: 'Too long — keep it under 120 characters' });

  const last = lastPrompt.get(session) || 0;
  if (Date.now() - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
    return res.status(429).json({ error: `Wait ${wait}s before sending again` });
  }

  if (promptQueue.length >= MAX_QUEUE) {
    return res.status(503).json({ error: 'Queue is full — try again in a moment' });
  }

  lastPrompt.set(session, Date.now());
  lastPromptTime = Date.now();

  promptQueue.push({ text: text.trim(), session, ts: Date.now() });
  const position = promptQueue.length + (queueProcessing ? 1 : 0);

  io.emit('queue_update', { queueLength: promptQueue.length });
  res.json({ ok: true, position });
});

// Facilitator override
app.post('/override', (req, res) => {
  const { secret, params } = req.body;
  if (secret !== process.env.FACILITATOR_SECRET && process.env.FACILITATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  state = { ...state, ...params };
  io.emit('state', state);
  res.json({ ok: true });
});

app.post('/reset', (req, res) => {
  const { secret } = req.body || {};
  if (secret !== process.env.FACILITATOR_SECRET && process.env.FACILITATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  promptQueue = [];
  queueProcessing = false;
  state = {
    hue: 200, saturation: 0.45, brightness: 0.55,
    speed: 0.15, complexity: 0.2, size: 0.5, chaos: 0.08,
    label: '', rainbow: false, promptCount: 0
  };
  lastPromptTime = Date.now() - IDLE_TIMEOUT_MS; // let it idle immediately
  io.emit('reset');
  io.emit('state', state);
  io.emit('queue_update', { queueLength: 0 });
  res.json({ ok: true });
});

app.get('/state', (req, res) => res.json(state));

// Inject a word at the front of the queue (facilitator seeding)
app.post('/seed', (req, res) => {
  const { secret, text } = req.body || {};
  if (secret !== process.env.FACILITATOR_SECRET && process.env.FACILITATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  if (!text || text.trim().length === 0) return res.status(400).json({ error: 'Empty' });
  promptQueue.unshift({ text: text.trim(), session: 'facilitator', ts: Date.now() });
  io.emit('queue_update', { queueLength: promptQueue.length });
  processNext();
  res.json({ ok: true });
});

// Freeze / unfreeze — pauses queue and idle drift, holds current visual state
app.post('/freeze', (req, res) => {
  const { secret } = req.body || {};
  if (secret !== process.env.FACILITATOR_SECRET && process.env.FACILITATOR_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  frozen = !frozen;
  io.emit(frozen ? 'freeze' : 'unfreeze');
  res.json({ ok: true, frozen });
});

// Expose public URL for QR code generation on display
app.get('/config', (req, res) => {
  const port = process.env.PORT || 3000;
  const audienceUrl = process.env.PUBLIC_URL || `http://${getLocalIP()}:${port}`;
  res.json({ audienceUrl });
});

io.on('connection', (socket) => {
  socket.emit('state', state);
  socket.emit('queue_update', { queueLength: promptQueue.length + (queueProcessing ? 1 : 0) });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log(`Hive Mind Blob running`);
  console.log(`  Local:       http://localhost:${PORT}`);
  console.log(`  Network:     http://${ip}:${PORT}`);
  console.log(`  Display:     http://localhost:${PORT}/display.html`);
  console.log(`  Audience:    http://${ip}:${PORT}/  ← share this URL / QR`);
  console.log(`  Facilitator: http://localhost:${PORT}/facilitator.html`);
});
