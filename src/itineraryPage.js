// Server-side renderer for the shareable itinerary page (/itinerary/:id).
// Matches the main site's "North Atlantic at dusk" design system.

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function weatherEmoji(summary = '') {
  const s = summary.toLowerCase();
  if (s.includes('thunder')) return '⛈️';
  if (s.includes('snow')) return '❄️';
  if (s.includes('rain') || s.includes('drizzle') || s.includes('shower')) return '🌧️';
  if (s.includes('fog')) return '🌫️';
  if (s.includes('overcast')) return '☁️';
  if (s.includes('cloud')) return '⛅';
  if (s.includes('clear')) return '☀️';
  return '🌤️';
}

function spotCard(s, icon) {
  if (!s) return '';
  const dist = s.distance_km != null ? `<span class="dist">${s.distance_km} km away</span>` : '';
  return `
    <div class="spot">
      <div class="spot-ic">${icon}</div>
      <div class="spot-body">
        <p class="spot-name">${esc(s.name)}</p>
        <p class="spot-meta">${esc(s.type || '')}${s.region ? ' · ' + esc(s.region) : ''} ${dist}</p>
        <div class="spot-links">
          <a href="${esc(s.maps_url)}" target="_blank" rel="noopener">📍 Map</a>
          <a href="${esc(s.reviews_url)}" target="_blank" rel="noopener">⭐ Reviews ↗</a>
        </div>
      </div>
    </div>`;
}

function listSection(title, sub, items, icon) {
  if (!items || !items.length) return '';
  return `
    <section class="card">
      <h2>${title}</h2>
      <p class="sub">${sub}</p>
      <div class="spot-grid">${items.map((s) => spotCard(s, icon)).join('')}</div>
    </section>`;
}

export function renderItineraryPage(it) {
  if (!it) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Itinerary not found</title><style>body{font-family:system-ui;background:#0a1626;color:#e7f0f7;display:grid;place-items:center;height:100vh;margin:0;text-align:center}a{color:#f2a83b}</style></head><body><div><h1>🧭 Itinerary not found</h1><p>This itinerary may have expired or the link is wrong.</p><p><a href="/">← Back to Nova Scotia Explorer</a></p></div></body></html>`;
  }

  const r = it.season.trip_month_rank;
  const verdict =
    r <= 3 ? 'Peak season — lively but busy, book ahead.'
    : r <= 6 ? 'Shoulder season — quieter and good value.'
    : 'Off season — quiet; double-check that spots are open.';

  const days = it.days.map((d, i) => {
    const w = d.weather;
    const wx = w
      ? `<span class="day-wx">${weatherEmoji(w.summary)} ${esc(w.summary)} · ${w.tmin}–${w.tmax}°C${w.chance_pct != null ? ` · ${w.chance_pct}% precip` : ''}${w.historical ? ' <em>(typical)</em>' : ''}</span>`
      : '';
    const row = (label, s) => s ? `<li><b>${label}:</b> ${esc(s.name)} <a href="${esc(s.maps_url)}" target="_blank" rel="noopener">map</a> · <a href="${esc(s.reviews_url)}" target="_blank" rel="noopener">reviews ↗</a></li>` : '';
    return `
      <div class="day">
        <div class="day-head">
          <span class="day-num">Day ${i + 1}</span>
          <span class="day-date">${fmtDate(d.date)}</span>
          ${wx}
        </div>
        <ul class="day-plan">
          ${row('Morning', d.morning)}
          ${row('Afternoon', d.afternoon)}
          ${row('Dinner', d.dinner)}
        </ul>
      </div>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(it.destination)} itinerary · ${esc(it.start_date)} → ${esc(it.end_date)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Outfit:wght@300..800&display=swap" rel="stylesheet" />
<style>
  :root{--ink:#0a1626;--deep:#0e2238;--ocean:#14385c;--tide:#2f7fb8;--azure:#4aa3d8;--mist:#bcd7ea;--paper:#f6f2ea;--card:#fffdf9;--amber:#f2a83b;--amber-deep:#d98324;--seaglass:#2a9d8f;--coral:#e76f51;--text:#1c2a3a;--soft:#5b6b7c;--line:#e6ded0;--fd:"Fraunces",Georgia,serif;--fu:"Outfit",system-ui,sans-serif}
  *{box-sizing:border-box}
  body{margin:0;font-family:var(--fu);background:var(--paper);color:var(--text);-webkit-font-smoothing:antialiased}
  a{color:var(--amber-deep)}
  .hero{position:relative;color:#fff;padding:40px 24px 56px;background:radial-gradient(900px 400px at 85% -10%,rgba(242,168,59,.16),transparent),linear-gradient(160deg,#060d18,var(--ink) 40%,var(--ocean))}
  .wrap{max-width:1000px;margin:0 auto}
  .back{display:inline-block;color:var(--mist);text-decoration:none;font-size:.86rem;margin-bottom:22px}
  .back:hover{color:#fff}
  .eyebrow{letter-spacing:.28em;text-transform:uppercase;font-size:.72rem;font-weight:700;color:var(--amber);margin:0 0 10px}
  h1{font-family:var(--fd);font-weight:380;font-size:clamp(2rem,5vw,3.2rem);margin:0 0 8px;line-height:1.08}
  h1 em{font-style:italic;color:var(--amber)}
  .meta{color:#c6d6e3;font-size:1.02rem;margin:0}
  .badges{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
  .badge{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 14px;font-size:.82rem;color:#e7f0f7}
  .badge b{color:var(--amber)}
  main{max-width:1000px;margin:-28px auto 60px;padding:0 20px;display:flex;flex-direction:column;gap:20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:0 14px 40px rgba(10,22,38,.10);padding:26px}
  .card h2{font-family:var(--fd);font-weight:460;font-size:1.4rem;margin:0 0 4px;color:var(--ink)}
  .card h2 em{color:var(--amber-deep);font-style:italic}
  .sub{color:var(--soft);margin:0 0 18px;font-size:.94rem}
  .spot-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
  .spot{display:flex;gap:12px;background:var(--paper);border:1px solid var(--line);border-radius:13px;padding:14px}
  .spot-ic{font-size:1.3rem;width:40px;height:40px;display:grid;place-items:center;background:#fff;border:1px solid var(--line);border-radius:11px;flex:none}
  .spot-name{font-family:var(--fd);font-weight:500;font-size:1rem;margin:0 0 3px;color:var(--ink)}
  .spot-meta{font-size:.8rem;color:var(--soft);margin:0 0 8px}
  .dist{display:inline-block;background:#fcefdd;color:#a4641c;border-radius:999px;padding:1px 8px;font-weight:700;font-size:.72rem;margin-left:4px}
  .spot-links{display:flex;gap:12px;font-size:.82rem;font-weight:600}
  .spot-links a{text-decoration:none}
  .spot-links a:hover{text-decoration:underline}
  .days{display:flex;flex-direction:column;gap:12px}
  .day{border:1px solid var(--line);border-radius:13px;padding:16px 18px;background:var(--paper)}
  .day-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px}
  .day-num{font-family:var(--fd);font-weight:600;color:var(--ink);background:#fff;border:1px solid var(--line);border-radius:8px;padding:3px 10px;font-size:.85rem}
  .day-date{font-weight:600;color:var(--tide)}
  .day-wx{font-size:.84rem;color:var(--soft)}
  .day-wx em{color:#94a2b0}
  .day-plan{margin:0;padding-left:18px;font-size:.92rem;line-height:1.7}
  .day-plan b{color:var(--ink)}
  .verdict{background:linear-gradient(135deg,rgba(242,168,59,.14),rgba(231,111,81,.10));border:1px solid #f0d9b6}
  .season-grid{display:flex;gap:22px;flex-wrap:wrap;font-size:.92rem}
  .season-grid div{flex:1;min-width:180px}
  .season-grid .k{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);font-weight:700;margin:0 0 4px}
  .footer{text-align:center;color:var(--soft);font-size:.82rem;padding:0 20px 50px}
  .footer a{color:var(--tide)}
  .cta{display:inline-block;margin-top:6px;background:linear-gradient(135deg,var(--amber),var(--amber-deep));color:var(--ink);text-decoration:none;font-weight:700;border-radius:11px;padding:12px 22px}
  @media print{.hero{background:var(--ink) !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.back,.printbtn{display:none}}
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <a class="back" href="/">← Nova Scotia Explorer</a>
      <p class="eyebrow">Your itinerary</p>
      <h1>${esc(it.destination)} <em>trip plan</em></h1>
      <p class="meta">${esc(it.region)} · ${fmtDate(it.start_date)} → ${fmtDate(it.end_date)} · ${it.days.length} day${it.days.length === 1 ? '' : 's'}</p>
      <div class="badges">
        <span class="badge">📍 Anchored on <b>${esc(it.anchor.name)}</b></span>
        ${it.popularity ? `<span class="badge">⭐ ${esc(it.popularity.community)} — visited by <b>${it.popularity.percent_of_visitors}%</b> (${it.popularity.survey_year})</span>` : ''}
        <span class="badge">🍽️ <b>${it.restaurants.length}</b> places to eat</span>
        <span class="badge">🛏️ <b>${it.hotels.length}</b> places to stay</span>
      </div>
    </div>
  </header>

  <main>
    <section class="card verdict">
      <h2>When to go</h2>
      <div class="season-grid">
        <div><p class="k">Your dates</p>${esc(it.season.trip_month)} — #${r} busiest month. ${verdict}</div>
        <div><p class="k">Peak season</p>${it.season.peak_months.map(esc).join(', ')}</div>
        <div><p class="k">Shoulder season</p>${it.season.shoulder_months.map(esc).join(', ')}</div>
      </div>
      ${it.weather_note ? `<p class="sub" style="margin-top:14px">🌦️ ${esc(it.weather_note)}</p>` : ''}
    </section>

    <section class="card">
      <h2>Day-by-day <em>plan</em></h2>
      <p class="sub">A suggested rhythm — sights by day, with dinner picked nearby. Weather shown per day where available.</p>
      <div class="days">${days}</div>
    </section>

    ${listSection('🍽️ Best places to <em>eat</em>', 'Nearest "Eat &amp; Drink" operators, closest first. Tap Reviews for live ratings.', it.restaurants, '🦪')}
    ${listSection('🛏️ Best places to <em>stay</em>', 'Nearest accommodations, closest first. Tap Reviews for live ratings.', it.hotels, '🛏️')}
    ${listSection('🏛️ Top <em>attractions</em>', 'Listed attractions near your destination.', it.attractions, '🏛️')}
    ${listSection('🛶 <em>Outdoor</em> activities &amp; tours', 'Things to do outside near your destination.', it.activities, '🛶')}

    <p style="text-align:center"><a class="cta printbtn" href="javascript:window.print()">🖨️ Save / print this itinerary</a></p>
  </main>

  <footer class="footer">
    Built ${new Date(it.created_at).toLocaleDateString('en-CA')} · Data from
    <a href="https://data.novascotia.ca" target="_blank" rel="noopener">Open Data Nova Scotia</a> &amp;
    <a href="https://open-meteo.com" target="_blank" rel="noopener">Open-Meteo</a>.
    Review links open a live web search — ratings are not part of the open dataset.
  </footer>
</body>
</html>`;
}
