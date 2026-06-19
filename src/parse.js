// Tiny natural-language parser for the demo-mode chat (no API key needed).
// Extracts a destination phrase and travel dates from free text like
// "I want to go to Peggy's Cove on June 20th" or "Cape Breton, Aug 10-15".

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
  september: 8, sept: 8, sep: 8, october: 9, oct: 9, november: 10, nov: 10,
  december: 11, dec: 11,
};
const MONTH_RE = '(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';

function iso(year, monthIdx, day) {
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Pick the year so the date is upcoming, not in the past.
function resolveYear(monthIdx, day) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let year = now.getFullYear();
  if (new Date(year, monthIdx, day) < today) year += 1;
  return year;
}

function addDaysISO(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function upcomingWeekend(weeksAhead = 0) {
  const now = new Date();
  const day = now.getDay();                 // 0 Sun .. 6 Sat
  let untilSat = (6 - day + 7) % 7;          // days to next Saturday
  if (untilSat === 0) untilSat = 0;          // today is Saturday → this Saturday
  const sat = new Date(now.getFullYear(), now.getMonth(), now.getDate() + untilSat + weeksAhead * 7);
  const start = sat.toISOString().slice(0, 10);
  return { start_date: start, end_date: addDaysISO(start, 1) };
}

/** Parse dates from text → { start_date, end_date } | null. */
export function parseDates(text) {
  const t = ' ' + text.toLowerCase() + ' ';

  // ISO range or single: 2026-06-20 [to 2026-06-25]
  let m = t.match(/\b(\d{4}-\d{2}-\d{2})\b(?:\s*(?:-|–|—|to|until|through)\s*(\d{4}-\d{2}-\d{2}))?/);
  if (m) return { start_date: m[1], end_date: m[2] || m[1] };

  // Relative weekends
  if (/\bthis weekend\b/.test(t)) return upcomingWeekend(0);
  if (/\bnext weekend\b/.test(t)) return upcomingWeekend(1);

  // Month DAY [ - [Month] DAY ]  e.g. "june 20-25", "aug 10 to 17", "june 20th–june 25th"
  m = t.match(new RegExp(
    `\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?` +
    `(?:\\s*(?:-|–|—|to|until|through|and)\\s*(?:(${MONTH_RE})\\.?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?`
  ));
  if (m) {
    const m1 = MONTHS[m[1]];
    const d1 = Number(m[2]);
    if (m[4] != null) {                       // a range
      const m2 = m[3] != null ? MONTHS[m[3]] : m1;
      const d2 = Number(m[4]);
      const y1 = resolveYear(m1, d1);
      const y2 = m2 < m1 ? y1 + 1 : y1;        // wrapped to next year
      return { start_date: iso(y1, m1, d1), end_date: iso(y2, m2, d2) };
    }
    const y = resolveYear(m1, d1);             // single date → 1-day trip
    const s = iso(y, m1, d1);
    return { start_date: s, end_date: s };
  }

  // DAY Month .. DAY [Month]  e.g. "20th June to 22nd June", "20 June - 25 July"
  m = t.match(new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\.?` +
    `\\s*(?:-|–|—|to|until|through|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})?`
  ));
  if (m) {
    const d1 = Number(m[1]);
    const m1 = MONTHS[m[2]];
    const d2 = Number(m[3]);
    const m2 = m[4] != null ? MONTHS[m[4]] : m1;
    const y1 = resolveYear(m1, d1);
    const y2 = m2 < m1 ? y1 + 1 : y1;
    return { start_date: iso(y1, m1, d1), end_date: iso(y2, m2, d2) };
  }

  // DAY - DAY Month  e.g. "20-22 June", "20 to 22 june"
  m = t.match(new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|–|—|to|until|through|and)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`
  ));
  if (m) {
    const d1 = Number(m[1]);
    const d2 = Number(m[2]);
    const mi = MONTHS[m[3]];
    const y = resolveYear(mi, Math.min(d1, d2));
    return { start_date: iso(y, mi, d1), end_date: iso(y, mi, d2) };
  }

  // DAY Month  e.g. "20 June", "20th of August"
  m = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_RE})\\b`));
  if (m) {
    const mi = MONTHS[m[2]];
    const d = Number(m[1]);
    const y = resolveYear(mi, d);
    const s = iso(y, mi, d);
    return { start_date: s, end_date: s };
  }

  return null;
}

/** Extract a likely destination phrase from text (may be ''). */
export function extractDestinationPhrase(text) {
  let t = ' ' + text + ' ';

  // Remove date expressions so they don't leak into the destination.
  t = t.replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  t = t.replace(/\b(this|next)\s+weekend\b/gi, ' ');
  // Month-first ranges/singles: "June 20", "June 20-25", "Aug 10 to 17"
  t = t.replace(new RegExp(
    `\\b(?:on|from|between|by|around|during|in|the)?\\s*${MONTH_RE}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?` +
    `(?:\\s*(?:-|–|—|to|until|through|and)\\s*(?:${MONTH_RE}\\.?\\s+)?\\d{1,2}(?:st|nd|rd|th)?)?`, 'gi'), ' ');
  // Day-first ranges: "20th June to 22nd June", "20 June - 25 July", "20-22 June"
  t = t.replace(new RegExp(
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?` +
    `\\s*(?:-|–|—|to|until|through|and)\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}?`, 'gi'), ' ');
  t = t.replace(new RegExp(
    `\\b\\d{1,2}(?:st|nd|rd|th)?\\s*(?:-|–|—|to|until|through|and)\\s*\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'gi'), ' ');
  // Day-first single: "20th June", "20 of August"
  t = t.replace(new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, 'gi'), ' ');
  // Any leftover bare day tokens left by a stripped range, e.g. "from 20th to"
  t = t.replace(/\b\d{1,2}(?:st|nd|rd|th)\b/gi, ' ');

  // Prefer text after an explicit travel trigger; else after a locator word.
  let phrase = null;
  const trig = t.match(/\b(?:go(?:ing)?\s+to|travel(?:ling)?\s+to|trip\s+to|head(?:ing)?\s+to|fly(?:ing)?\s+to|visit(?:ing)?|explore|tour)\s+(.+)/i);
  if (trig) phrase = trig[1];
  if (!phrase) {
    const loc = t.match(/\b(?:in|at|around|near|to)\s+(.+)/i);
    if (loc) phrase = loc[1];
  }
  if (!phrase) phrase = t;

  // Strip filler words (incl. date connectors) and punctuation; keep place names.
  phrase = phrase
    .replace(/[?!.,;:"]/g, ' ')
    .replace(/\b(please|plan|planning|my|our|a|an|the|trip|holiday|vacation|getaway|for|day|days|night|nights|week|weekend|sometime|early|late|mid|next|this|on|in|at|from|to|until|till|through|between|by|around|during|i|we|want|wanna|would|like|love|go|going|visit|visiting|see|explore|and|with|family|kids|friends|me|us|somewhere|place|spots?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return phrase;
}

/**
 * Scan a conversation (newest-first) and accumulate a trip request,
 * letting meta from the form take priority.
 */
export function parseTripFromMessages(messages = [], meta = {}) {
  let destination = (meta.destination || '').trim();
  let start_date = meta.start_date || null;
  let end_date = meta.end_date || null;

  const userTexts = messages.filter((m) => m && m.role === 'user' && typeof m.content === 'string')
    .map((m) => m.content)
    .reverse();

  for (const txt of userTexts) {
    if (!start_date) {
      const d = parseDates(txt);
      if (d) { start_date = d.start_date; end_date = d.end_date; }
    }
    if (!destination) {
      const p = extractDestinationPhrase(txt);
      if (p) destination = p;
    }
    if (destination && start_date) break;
  }

  if (!end_date) end_date = start_date;
  return { destination, start_date, end_date };
}
