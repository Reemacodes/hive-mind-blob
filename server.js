require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const client = new Anthropic();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default blob state
let state = {
  hue: 200,
  saturation: 0.6,
  brightness: 0.7,
  speed: 0.3,
  complexity: 0.4,
  size: 1.0,
  chaos: 0.2,
  label: '',
  promptCount: 0
};

const IDLE_STATE = { hue: 200, saturation: 0.45, brightness: 0.6, speed: 0.2, complexity: 0.3, size: 1.0, chaos: 0.1 };
const IDLE_TIMEOUT_MS = 12000; // calm down after 12s of no prompts
let lastPromptTime = Date.now();

// Gradually drift back to calm when idle
setInterval(() => {
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
  if (changed) io.emit('state', state);
}, 500);

const SYSTEM_PROMPT = `You are a visual parameter interpreter for a live generative art installation called the Hive Mind Blob.

Given a short text prompt from an audience member, return a JSON object with visual parameters that reflect the emotional and aesthetic quality of the input.

Return ONLY valid JSON with no explanation, no markdown, no code fences.

Schema:
{
  "hue": <0-360>,
  "saturation": <0.0-1.0>,
  "brightness": <0.0-1.0>,
  "speed": <0.0-1.0>,
  "complexity": <0.0-1.0>,
  "size": <0.5-1.5>,
  "chaos": <0.0-1.0>,
  "label": "<1-3 word label>"
}

Be DRAMATIC. Push parameters to extremes — the blob should feel radically different for each emotion.

Examples:
- "anxious" → {"hue":5,"saturation":1.0,"brightness":0.8,"speed":1.0,"complexity":1.0,"size":1.2,"chaos":1.0,"label":"anxious"}
- "sad" → {"hue":220,"saturation":0.2,"brightness":0.15,"speed":0.05,"complexity":0.15,"size":0.7,"chaos":0.02,"label":"sad"}
- "calm" → {"hue":195,"saturation":0.5,"brightness":0.85,"speed":0.08,"complexity":0.1,"size":1.0,"chaos":0.02,"label":"calm"}
- "rage" → {"hue":0,"saturation":1.0,"brightness":0.6,"speed":1.0,"complexity":1.0,"size":1.5,"chaos":1.0,"label":"rage"}
- "joyful" → {"hue":50,"saturation":1.0,"brightness":1.0,"speed":0.85,"complexity":0.7,"size":1.1,"chaos":0.6,"label":"joyful"}
- "powerful" → {"hue":270,"saturation":0.9,"brightness":0.4,"speed":0.4,"complexity":0.4,"size":1.5,"chaos":0.08,"label":"powerful"}
- "melancholy" → {"hue":240,"saturation":0.25,"brightness":0.2,"speed":0.06,"complexity":0.2,"size":0.75,"chaos":0.03,"label":"melancholy"}
- "chaotic" → {"hue":310,"saturation":1.0,"brightness":0.7,"speed":1.0,"complexity":1.0,"size":1.3,"chaos":1.0,"label":"chaotic"}
- "love" → {"hue":330,"saturation":0.9,"brightness":0.75,"speed":0.35,"complexity":0.5,"size":1.15,"chaos":0.2,"label":"love"}
- "frozen" → {"hue":200,"saturation":0.15,"brightness":0.5,"speed":0.0,"complexity":0.05,"size":0.85,"chaos":0.0,"label":"frozen"}`;

function blend(current, incoming, weight = 0.85) {
  const result = {};
  for (const key of Object.keys(current)) {
    if (key === 'label' || key === 'promptCount') continue;
    result[key] = current[key] * (1 - weight) + incoming[key] * weight;
  }
  result.label = incoming.label;
  result.promptCount = current.promptCount;
  return result;
}

// Rate limiting: per session token (not IP — venue WiFi shares one IP)
const lastPrompt = new Map();
const RATE_LIMIT_MS = 3000;

function getSession(req, res) {
  let id = req.headers['x-session-id'];
  if (!id || id.length < 8) {
    id = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  return id;
}

app.post('/prompt', async (req, res) => {
  const { text, sessionId } = req.body;
  const session = sessionId || getSession(req, res);

  if (!text || text.trim().length === 0) {
    return res.status(400).json({ error: 'Empty prompt' });
  }
  if (text.length > 120) {
    return res.status(400).json({ error: 'Too long — keep it under 120 characters' });
  }

  const last = lastPrompt.get(session) || 0;
  if (Date.now() - last < RATE_LIMIT_MS) {
    const wait = Math.ceil((RATE_LIMIT_MS - (Date.now() - last)) / 1000);
    return res.status(429).json({ error: `Wait ${wait}s before sending again` });
  }
  lastPrompt.set(session, Date.now());
  lastPromptTime = Date.now();

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text.trim() }]
    });

    const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '');
    const incoming = JSON.parse(raw);

    state = blend(state, incoming);
    state.promptCount += 1;

    io.emit('state', state);
    res.json({ ok: true, label: incoming.label, count: state.promptCount });
  } catch (err) {
    console.error('Claude error:', err.message);
    res.status(500).json({ error: 'Failed to process prompt' });
  }
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

app.get('/state', (req, res) => res.json(state));

io.on('connection', (socket) => {
  socket.emit('state', state);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Hive Mind Blob running at http://localhost:${PORT}`);
  console.log(`  Display:     http://localhost:${PORT}/display.html`);
  console.log(`  Audience:    http://localhost:${PORT}/`);
  console.log(`  Facilitator: http://localhost:${PORT}/facilitator.html`);
});
