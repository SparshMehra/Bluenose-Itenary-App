import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, fallbackRecommend, hasApiKey } from './src/agent.js';
import { searchDestinations, listRegions, listTypes, getSummary, getVisitationByMonth, getCommunityPopularity } from './src/nsData.js';
import { buildItinerary, getItinerary, listItinerariesByOwner } from './src/itinerary.js';
import { renderItineraryPage } from './src/itineraryPage.js';
import { securityHeaders, rateLimit, cleanStr, cleanDate } from './src/security.js';
import { startDailyPipeline, getDataStatus } from './src/pipeline.js';
import {
  registerUser, authenticate, createSessionToken,
  setSessionCookie, clearSessionCookie, attachUser, requireAuth,
} from './src/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);                 // correct client IP behind a proxy
app.use(securityHeaders);
app.use(express.json({ limit: '64kb' }));  // tight body cap — these payloads are small

// Generous limiter for the whole app; stricter ones on write/AI endpoints below.
app.use(rateLimit({ windowMs: 60_000, max: 120 }));
const writeLimiter = rateLimit({ windowMs: 60_000, max: 20, message: 'Too many requests — please wait a minute.' });
const authLimiter = rateLimit({ windowMs: 60_000, max: 10, message: 'Too many attempts — please wait a minute.' });

app.use(attachUser); // sets req.user from the session cookie (or null)

// Logged-in users shouldn't see the login page; send them home.
app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ---- Auth endpoints ----
app.post('/api/auth/register', authLimiter, (req, res) => {
  try {
    const user = registerUser({
      email: cleanStr(req.body?.email, 200),
      password: String(req.body?.password || ''),
      name: cleanStr(req.body?.name, 80),
    });
    setSessionCookie(req, res, createSessionToken(user.id));
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const user = authenticate({
    email: cleanStr(req.body?.email, 200),
    password: String(req.body?.password || ''),
  });
  if (!user) return res.status(401).json({ error: 'Wrong email or password.' });
  setSessionCookie(req, res, createSessionToken(user.id));
  res.json({ user });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user || null });
});

// Itineraries owned by the logged-in user.
app.get('/api/my/itineraries', requireAuth, async (req, res) => {
  try {
    res.json(await listItinerariesByOwner(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Data endpoints (also usable directly by the UI) ---

app.get('/api/status', (_req, res) => {
  res.json({ ai_enabled: hasApiKey() });
});

// When was the open-data snapshot last refreshed by the daily pipeline?
app.get('/api/data-status', async (_req, res) => {
  try {
    const manifest = await getDataStatus();
    if (!manifest) return res.json({ updatedAt: null, datasets: [] });
    res.json({
      updatedAt: manifest.updatedAt,
      ok: manifest.ok,
      datasets: manifest.datasets.map((d) => ({ id: d.id, name: d.name, ok: d.ok, count: d.count })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/destinations', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 200); // clamp 1..200
    const results = await searchDestinations({
      query: cleanStr(req.query.q),
      region: cleanStr(req.query.region),
      type: cleanStr(req.query.type),
      limit,
    });
    res.json(results);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/regions', async (_req, res) => {
  try {
    res.json(await listRegions());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/types', async (_req, res) => {
  try {
    res.json(await listTypes());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/summary', async (_req, res) => {
  try {
    res.json(await getSummary());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/visitation', async (_req, res) => {
  try {
    res.json(await getVisitationByMonth());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get('/api/popular', async (req, res) => {
  try {
    res.json(await getCommunityPopularity({ region: req.query.region || '', limit: 15 }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- AI agent endpoint ---
// Body: { messages: [{role, content}...], meta?: { destination, start_date, end_date } }
app.post('/api/chat', writeLimiter, async (req, res) => {
  const { messages, meta } = req.body || {};
  // Validate shape: bounded array of {role, content} with safe values.
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 40) {
    return res.status(400).json({ error: 'messages must be a non-empty array (max 40).' });
  }
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > 4000) {
      return res.status(400).json({ error: 'Each message needs role user/assistant and content under 4000 chars.' });
    }
  }
  const safeMeta = meta && typeof meta === 'object'
    ? { destination: cleanStr(meta.destination), start_date: cleanDate(meta.start_date), end_date: cleanDate(meta.end_date) }
    : {};
  const ownerId = req.user?.id || null;
  try {
    if (hasApiKey()) {
      try {
        const reply = await chat(messages, { ownerId });
        return res.json({ reply, ai: true });
      } catch (apiErr) {
        // Live Claude failed (e.g. no credits / rate limit). Don't lose the
        // request — fall back to the data-driven itinerary builder.
        console.error('Claude API failed, falling back:', apiErr.status, apiErr.message);
        const reply = await fallbackRecommend(safeMeta, messages, ownerId);
        const lowCredit = apiErr.status === 400 && /credit balance/i.test(apiErr.message || '');
        const note = lowCredit
          ? '> ⚠️ _The AI agent is set up, but your Anthropic account is out of credits — add some at console.anthropic.com → Plans & Billing. Until then, here is a data-built itinerary:_\n\n'
          : '> ⚠️ _The AI agent is temporarily unavailable; here is a data-built itinerary:_\n\n';
        return res.json({ reply: note + reply, ai: false, fallback: true });
      }
    }
    const reply = await fallbackRecommend(safeMeta, messages, ownerId);
    res.json({ reply, ai: false });
  } catch (err) {
    console.error('chat error:', err);
    res.status(500).json({ error: 'The travel agent ran into a problem. Please try again.' });
  }
});

// --- Itinerary: build (used by the trip-planner form) ---
app.post('/api/itinerary', writeLimiter, async (req, res) => {
  const body = req.body || {};
  const input = {
    destination: cleanStr(body.destination),
    start_date: cleanDate(body.start_date),
    end_date: cleanDate(body.end_date),
    notes: cleanStr(body.notes, 300),
    ownerId: req.user?.id || null, // tag the trip if the user is logged in
  };
  if (!input.destination || !input.start_date || !input.end_date) {
    return res.status(400).json({ error: 'destination, start_date (YYYY-MM-DD) and end_date are required.' });
  }
  try {
    const it = await buildItinerary(input);
    res.json(it);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// --- Itinerary: full shareable HTML page ---
app.get('/itinerary/:id', async (req, res) => {
  const it = await getItinerary(req.params.id);
  if (!it) {
    return res.status(404).send(renderItineraryPage(null));
  }
  res.type('html').send(renderItineraryPage(it));
});

app.listen(PORT, () => {
  console.log(`Nova Scotia Tourist Explorer running at http://localhost:${PORT}`);
  console.log(hasApiKey()
    ? 'AI agent: ENABLED (Claude)'
    : 'AI agent: demo mode (set ANTHROPIC_API_KEY in .env for full AI chat)');

  // Start the daily data pipeline: refresh on boot if stale, then daily at 03:00.
  startDailyPipeline().catch((e) => console.error('Failed to start data pipeline:', e.message));
});
