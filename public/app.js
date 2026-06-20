// Nova Scotia Explorer — frontend
// Live stats with count-up, destination directory with skeletons,
// region cards, animated seasonality chart, trip "ticket" planner,
// and the Bluenose AI chat widget.

const $ = (id) => document.getElementById(id);

const state = {
  conversation: [],
  lastMeta: null,
  destinations: [],
  shown: 0,
  pageSize: 12,
  chart: { months: null, bars: [], hover: -1, progress: 0, animated: false },
};

const TYPE_META = {
  Attraction: { icon: '🏛️', accent: 'linear-gradient(90deg,#e76f51,#f2a83b)' },
  Accommodation: { icon: '🛏️', accent: 'linear-gradient(90deg,#2f7fb8,#4aa3d8)' },
  Campground: { icon: '⛺', accent: 'linear-gradient(90deg,#2a9d8f,#7cc7a1)' },
  'Eat & Drink': { icon: '🦪', accent: 'linear-gradient(90deg,#b5651d,#f2a83b)' },
  'Outdoor Activities and Tours': { icon: '🛶', accent: 'linear-gradient(90deg,#14385c,#2a9d8f)' },
};

init();

function init() {
  $('startDate').value = isoDaysFromNow(10);
  $('endDate').value = isoDaysFromNow(16);
  $('footerYear').textContent = new Date().getFullYear();

  // Navbar: glass on scroll + mobile menu
  const nav = $('nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 30);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  $('navToggle').addEventListener('click', () => $('navLinks').classList.toggle('open'));
  $('navLinks').addEventListener('click', (e) => {
    if (e.target.tagName === 'A') $('navLinks').classList.remove('open');
  });

  // Reveal-on-scroll
  wireReveals();

  // Chat widget
  $('chatFab').addEventListener('click', toggleChat);
  $('chatClose').addEventListener('click', toggleChat);
  $('navChatBtn').addEventListener('click', openChat);
  $('heroChatBtn').addEventListener('click', openChat);
  $('chatChips').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) sendMessage(chip.dataset.chip);
  });
  $('chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    $('chatInput').value = '';
    sendMessage(text);
  });

  // Trip ticket
  $('tripForm').addEventListener('submit', onPlanSubmit);
  wireAutocomplete();

  // Directory filters
  $('filterSearch').addEventListener('input', debounce(loadDirectory, 300));
  $('filterRegion').addEventListener('change', loadDirectory);
  $('filterType').addEventListener('change', loadDirectory);
  $('loadMoreBtn').addEventListener('click', () => renderCards(true));

  // Data loads (parallel)
  showSkeletons();
  loadStatus();
  loadAuth();
  loadDataFreshness();
  loadFilters();
  loadDirectory();
  loadRegions();
  loadSeasonChart();
}

/* ───────────── auth / account ───────────── */

let currentUser = null;

async function loadAuth() {
  try {
    const { user } = await getJson('/api/auth/me');
    currentUser = user;
    renderAuth();
    if (user) loadMyTrips();
  } catch { /* navbar stays as Login */ renderAuth(); }
}

function renderAuth() {
  const el = $('navAuth');
  if (!el) return;
  if (!currentUser) {
    el.innerHTML = '<a class="nav-login" href="/login">Log in</a>';
    return;
  }
  const initial = (currentUser.name || currentUser.email || '?').trim().charAt(0).toUpperCase();
  el.innerHTML = `
    <div class="account">
      <button class="account-btn" id="accountBtn" aria-haspopup="true">
        <span class="account-avatar">${escapeHtml(initial)}</span>
        ${escapeHtml(currentUser.name || 'Account')} ▾
      </button>
      <div class="account-menu" id="accountMenu" hidden>
        <div class="who"><strong>${escapeHtml(currentUser.name || '')}</strong><span>${escapeHtml(currentUser.email)}</span></div>
        <a href="#my-trips" id="menuMyTrips">🗺️ My trips</a>
        <button type="button" id="logoutBtn">↪ Log out</button>
      </div>`;
  const btn = $('accountBtn');
  const menu = $('accountMenu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  document.addEventListener('click', () => { menu.hidden = true; });
  $('logoutBtn').addEventListener('click', logout);
}

async function logout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
  currentUser = null;
  renderAuth();
  $('my-trips').hidden = true;
}

async function loadMyTrips() {
  try {
    const trips = await getJson('/api/my/itineraries');
    const section = $('my-trips');
    const grid = $('myTripsGrid');
    if (!trips.length) {
      section.hidden = false;
      grid.innerHTML = '<p class="muted">No saved trips yet — plan one below and it\'ll appear here.</p>';
      return;
    }
    section.hidden = false;
    grid.innerHTML = '';
    trips.forEach((t, i) => {
      const card = document.createElement('div');
      card.className = 'dest-card';
      card.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
      card.style.setProperty('--accent', 'linear-gradient(90deg,#f2a83b,#e76f51)');
      card.innerHTML = `
        <div class="dest-icon">🧭</div>
        <h3>${escapeHtml(t.destination)}</h3>
        <div class="dest-tags"><span class="tag region">${escapeHtml(t.region || 'Nova Scotia')}</span></div>
        <p class="trip-dates">${escapeHtml(t.start_date)} → ${escapeHtml(t.end_date)}</p>`;
      const a = document.createElement('a');
      a.className = 'card-cta';
      a.href = t.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = 'Open itinerary <span>→</span>';
      card.appendChild(a);
      grid.appendChild(card);
    });
  } catch { /* leave hidden */ }
}

async function loadDataFreshness() {
  try {
    const s = await getJson('/api/data-status');
    const el = $('dataFreshness');
    if (!el) return;
    if (s.updatedAt) {
      const when = new Date(s.updatedAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
      const rows = s.datasets.reduce((sum, d) => sum + (d.count || 0), 0);
      el.textContent = ` · 🔄 Open data refreshed daily — last updated ${when} (${rows.toLocaleString()} records)`;
    } else {
      el.textContent = ' · 🔄 Open data refreshes daily';
    }
  } catch { /* footer note is optional */ }
}

/* ───────────── reveal-on-scroll ───────────── */

function wireReveals() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
          if (e.target.id === 'statsStrip' || e.target.closest('.stats-strip')) runCountUps();
          if (e.target.querySelector?.('#seasonChart') || e.target.id === 'seasonChart') animateChart();
        }
      }
    },
    { threshold: 0.18 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  // chart card may not have .reveal observed yet when chart data arrives
  state.chartObserver = io;
}

/* ───────────── data loading ───────────── */

async function loadStatus() {
  try {
    const status = await getJson('/api/status');
    $('aiBadge').textContent = status.ai_enabled ? 'live' : 'demo';
  } catch {
    $('aiBadge').textContent = 'offline';
  }
}

async function loadFilters() {
  try {
    const [regions, types] = await Promise.all([getJson('/api/regions'), getJson('/api/types')]);
    fillSelect($('filterRegion'), regions);
    fillSelect($('filterType'), types);
  } catch { /* selects stay generic */ }
}

function showSkeletons() {
  const grid = $('destGrid');
  grid.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const sk = document.createElement('div');
    sk.className = 'skeleton';
    grid.appendChild(sk);
  }
}

async function loadDirectory() {
  const q = $('filterSearch').value.trim();
  const region = $('filterRegion').value;
  const type = $('filterType').value;
  try {
    const params = new URLSearchParams({ q, region, type, limit: '200' });
    state.destinations = await getJson(`/api/destinations?${params}`);
    state.shown = 0;
    renderCards();
  } catch {
    $('destGrid').innerHTML = '<p class="muted">Could not load destinations — is the server running?</p>';
  }
}

function renderCards(append = false) {
  const grid = $('destGrid');
  if (!append) grid.innerHTML = '';
  const next = state.destinations.slice(state.shown, state.shown + state.pageSize);
  if (!append && next.length === 0) {
    grid.innerHTML = '<p class="muted">No spots matched. Try a broader search or another region.</p>';
  }
  next.forEach((d, i) => {
    const meta = TYPE_META[d.type] || { icon: '📍', accent: 'linear-gradient(90deg,#2f7fb8,#4aa3d8)' };
    const card = document.createElement('div');
    card.className = 'dest-card';
    card.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
    card.style.setProperty('--accent', meta.accent);
    card.innerHTML = `
      <div class="dest-icon">${meta.icon}</div>
      <h3>${escapeHtml(d.name)}</h3>
      <div class="dest-tags">
        <span class="tag">${escapeHtml(d.type || 'Spot')}</span>
        <span class="tag region">${escapeHtml(d.region || 'Nova Scotia')}</span>
      </div>`;
    const btn = document.createElement('button');
    btn.className = 'card-cta';
    btn.innerHTML = 'Plan a trip here <span>→</span>';
    btn.addEventListener('click', () => {
      $('destination').value = d.name;
      document.querySelector('#plan').scrollIntoView({ behavior: 'smooth' });
    });
    card.appendChild(btn);
    grid.appendChild(card);
  });
  state.shown += next.length;
  $('loadMoreBtn').hidden = state.shown >= state.destinations.length;
}

async function loadRegions() {
  try {
    const summary = await getJson('/api/summary');
    setCountTarget($('statOperators'), summary.total_operators);
    setCountTarget($('statRegions'), summary.by_region.length);
    $('heroCount').textContent = summary.total_operators.toLocaleString();

    const popular = await getJson('/api/popular');
    if (popular.length) $('statTopSpot').textContent = popular[0].community;
    runCountUps();

    // Region names differ across datasets ("Cape Breton Island" vs
    // "Cape Breton Island Region", "&" vs "and") — normalize to match.
    const normRegion = (s) => (s || '').toLowerCase().replace(/region/g, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim();

    const grid = $('regionGrid');
    grid.innerHTML = '';
    summary.by_region.forEach((r, i) => {
      const topHere = popular.filter((p) => normRegion(p.region) === normRegion(r.region)).slice(0, 2);
      const card = document.createElement('div');
      card.className = 'region-card reveal';
      card.style.transitionDelay = `${i * 70}ms`;
      card.innerHTML = `
        <span class="region-ordinal">${String(i + 1).padStart(2, '0')}</span>
        <h3>${escapeHtml(r.region)}</h3>
        <span class="count">${r.count.toLocaleString()} listed spots</span>
        ${topHere.length ? `<div class="top-com">⭐ Most visited: ${topHere.map((t) => `<b>${escapeHtml(t.community)}</b> (${t.percent_of_visitors}%)`).join(' · ')}</div>` : ''}`;
      const btn = document.createElement('button');
      btn.textContent = 'Browse this region →';
      btn.addEventListener('click', () => {
        $('filterRegion').value = r.region;
        loadDirectory();
        document.querySelector('#destinations').scrollIntoView({ behavior: 'smooth' });
      });
      card.appendChild(btn);
      grid.appendChild(card);
      state.chartObserver.observe(card);
    });
  } catch {
    $('regionGrid').innerHTML = '<p class="muted">Could not load region data.</p>';
  }
}

/* ───────────── count-up stats ───────────── */

function setCountTarget(el, value) {
  el.dataset.target = value;
  el.textContent = '0';
}

function runCountUps() {
  document.querySelectorAll('[data-countup]').forEach((el) => {
    const target = Number(el.dataset.target);
    if (!target || el.dataset.done) return;
    el.dataset.done = '1';
    const t0 = performance.now();
    const dur = 1400;
    (function tick(now) {
      const p = Math.min((now - t0) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString();
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  });
}

/* ───────────── seasonality chart ───────────── */

async function loadSeasonChart() {
  try {
    const data = await getJson('/api/visitation');
    state.chart.months = data.averageByCalendarMonth;
    const busiest = state.chart.months.reduce((a, b) => (b.avg_visitors > a.avg_visitors ? b : a));
    $('statBusiest').textContent = busiest.month;

    const canvas = $('seasonChart');
    canvas.addEventListener('mousemove', onChartHover);
    canvas.addEventListener('mouseleave', () => { state.chart.hover = -1; drawChart(); });
    window.addEventListener('resize', debounce(() => drawChart(), 200));

    // If the card is already on screen, animate now; otherwise the observer fires it
    const rect = canvas.getBoundingClientRect();
    if (rect.top < window.innerHeight) animateChart();
  } catch { /* chart card stays empty */ }
}

function animateChart() {
  const c = state.chart;
  if (!c.months || c.animated) return;
  c.animated = true;
  const t0 = performance.now();
  const dur = 1100;
  (function tick(now) {
    c.progress = Math.min((now - t0) / dur, 1);
    drawChart();
    if (c.progress < 1) requestAnimationFrame(tick);
  })(t0);
}

function drawChart() {
  const c = state.chart;
  if (!c.months) return;
  const canvas = $('seasonChart');
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement.clientWidth - 8;
  const cssH = 300;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const values = c.months.map((m) => m.avg_visitors);
  const max = Math.max(...values) || 1;
  const ranked = [...values].sort((a, b) => b - a);
  const peakCut = ranked[2];
  const shoulderCut = ranked[6];

  const padB = 38, padT = 30, padL = 8;
  const w = cssW - padL * 2;
  const gap = w / 12;
  const barW = gap * 0.6;
  const ease = 1 - Math.pow(1 - c.progress, 3);

  // faint gridlines
  ctx.strokeStyle = 'rgba(28, 42, 58, 0.06)';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const gy = padT + ((cssH - padB - padT) * g) / 4;
    ctx.beginPath();
    ctx.moveTo(padL, gy);
    ctx.lineTo(cssW - padL, gy);
    ctx.stroke();
  }

  c.bars = [];
  c.months.forEach((m, i) => {
    const fullH = ((cssH - padB - padT) * m.avg_visitors) / max;
    const h = fullH * ease;
    const x = padL + i * gap + (gap - barW) / 2;
    const y = cssH - padB - h;
    const hovered = c.hover === i;

    const base = m.avg_visitors >= peakCut ? '#e76f51' : m.avg_visitors >= shoulderCut ? '#2a9d8f' : '#c8d2db';
    ctx.fillStyle = base;
    ctx.globalAlpha = c.hover === -1 || hovered ? 1 : 0.45;
    roundRect(ctx, x, y, barW, h, 7);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = hovered ? '#0a1626' : '#8a97a5';
    ctx.font = `${hovered ? '700 ' : ''}11px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(m.month.slice(0, 3), x + barW / 2, cssH - 16);

    c.bars.push({ x, y, w: barW, h, i });
  });

  // hover tooltip
  if (c.hover >= 0 && c.progress === 1) {
    const m = c.months[c.hover];
    const b = c.bars[c.hover];
    const label = `${m.month}: ~${m.avg_visitors.toLocaleString()} visitors`;
    ctx.font = '600 12.5px Outfit, sans-serif';
    const tw = ctx.measureText(label).width + 22;
    let tx = b.x + b.w / 2 - tw / 2;
    tx = Math.max(6, Math.min(tx, cssW - tw - 6));
    const ty = Math.max(4, b.y - 34);
    ctx.fillStyle = '#0a1626';
    roundRect(ctx, tx, ty, tw, 26, 8);
    ctx.fill();
    ctx.fillStyle = '#f2a83b';
    ctx.textAlign = 'center';
    ctx.fillText(label, tx + tw / 2, ty + 17);
  }
}

function onChartHover(e) {
  const rect = e.target.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const hit = state.chart.bars.findIndex((b) => x >= b.x - 4 && x <= b.x + b.w + 4);
  if (hit !== state.chart.hover) {
    state.chart.hover = hit;
    drawChart();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  if (r < 0) r = 0;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ───────────── trip ticket ───────────── */

function onPlanSubmit(e) {
  e.preventDefault();
  const destination = $('destination').value.trim();
  const start = $('startDate').value;
  const end = $('endDate').value;
  if (!destination || !start || !end) return;
  if (end < start) {
    openChat();
    addMessage('agent', 'Your "Returning" date is before your "Departing" date — mind double-checking those?');
    return;
  }
  state.lastMeta = { destination, start_date: start, end_date: end };
  openChat();
  sendMessage(
    `I want to visit ${destination} from ${start} to ${end}. ` +
    'What are the best tourist spots there, what will the weather be like, and are those good dates to go?'
  );
}

function wireAutocomplete() {
  let timer = null;
  $('destination').addEventListener('input', () => {
    clearTimeout(timer);
    const q = $('destination').value.trim();
    if (q.length < 2) return;
    timer = setTimeout(async () => {
      try {
        const results = await getJson(`/api/destinations?q=${encodeURIComponent(q)}&limit=8`);
        const dl = $('destSuggestions');
        dl.innerHTML = '';
        for (const item of results) {
          const opt = document.createElement('option');
          opt.value = item.name;
          opt.label = `${item.type} · ${item.region}`;
          dl.appendChild(opt);
        }
      } catch { /* ignore */ }
    }, 250);
  });
}

/* ───────────── chat widget ───────────── */

function toggleChat() {
  const widget = $('chatWidget');
  widget.hidden = !widget.hidden;
  if (!widget.hidden) $('chatInput').focus();
}
function openChat() {
  $('chatWidget').hidden = false;
  $('chatInput').focus();
}

async function sendMessage(text) {
  const chips = $('chatChips');
  if (chips) chips.remove();

  addMessage('user', text);
  state.conversation.push({ role: 'user', content: text });
  setBusy(true);
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.conversation, meta: state.lastMeta }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    state.conversation.push({ role: 'assistant', content: data.reply });
    addMessage('agent', data.reply, { markdown: true });
    // If a logged-in user just got an itinerary, refresh their saved trips.
    if (currentUser && /\/itinerary\//.test(data.reply)) loadMyTrips();
  } catch (err) {
    addMessage('agent', `Sorry — something went wrong: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

function setBusy(busy) {
  $('typing').hidden = !busy;
  $('planBtn').disabled = busy;
  if (!busy) scrollChat();
}

function addMessage(who, text, { markdown = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${who}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (markdown) bubble.innerHTML = renderMarkdown(text);
  else bubble.textContent = text;
  wrap.appendChild(bubble);
  $('messages').appendChild(wrap);
  scrollChat();
}

function scrollChat() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

/* ───────────── helpers ───────────── */

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function fillSelect(select, values) {
  for (const v of values) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}

function isoDaysFromNow(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Minimal, safe markdown renderer (headings, bold, italics, bullets) */
function renderMarkdown(src) {
  const esc = escapeHtml(src);
  const lines = esc.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##?\s+(.*)/);
    if (h3) out.push(`<h3>${inline(h3[1])}</h3>`);
    else if (h2) out.push(`<h2>${inline(h2[1])}</h2>`);
    else if (line.trim() === '') out.push('<br/>');
    else out.push(`${inline(line)}<br/>`);
  }
  if (inList) out.push('</ul>');
  return out.join('');
}

function inline(s) {
  return s
    // [label](url) → safe anchor. Only allow relative or http(s) links.
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      const safe = /^(https?:\/\/|\/)/.test(url) ? url : '#';
      const external = /^https?:/.test(safe);
      const isItinerary = safe.startsWith('/itinerary/');
      const cls = isItinerary ? ' class="itinerary-link"' : '';
      const attrs = external ? ' target="_blank" rel="noopener"' : ' target="_blank"';
      return `<a href="${safe}"${attrs}${cls}>${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
}
