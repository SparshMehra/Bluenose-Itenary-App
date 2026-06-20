// Email delivery via Gmail SMTP (nodemailer).
// Configure in .env:
//   GMAIL_USER=you@gmail.com
//   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx   (a Google "App Password", NOT your login password)
// If these aren't set, email is silently disabled and the app keeps working.

import nodemailer from 'nodemailer';

let transporter = null;

export function isEmailEnabled() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      // App passwords are shown with spaces; strip them just in case.
      pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''),
    },
  });
  return transporter;
}

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

function spotLine(s) {
  if (!s) return '';
  const dist = s.distance_km != null ? ` · ${s.distance_km} km away` : '';
  return `<li style="margin:4px 0"><b>${esc(s.name)}</b>${dist}
    &nbsp;<a href="${esc(s.maps_url)}" style="color:#2f7fb8">map</a>
    &nbsp;<a href="${esc(s.reviews_url)}" style="color:#d98324">reviews ↗</a></li>`;
}

function buildEmailHtml(it, baseUrl) {
  const url = `${baseUrl}/itinerary/${it.id}`;
  const eat = (it.restaurants || []).slice(0, 4).map(spotLine).join('');
  const stay = (it.hotels || []).slice(0, 4).map(spotLine).join('');
  const see = (it.attractions || []).slice(0, 4).map(spotLine).join('');
  return `<!doctype html><html><body style="margin:0;background:#f6f2ea;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1c2a3a">
  <div style="max-width:600px;margin:0 auto;padding:24px">
    <div style="background:linear-gradient(135deg,#0a1626,#14385c);color:#fff;border-radius:16px;padding:26px">
      <p style="margin:0 0 6px;letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#f2a83b">Your itinerary</p>
      <h1 style="margin:0;font-size:26px">${esc(it.destination)}</h1>
      <p style="margin:8px 0 0;color:#c6d6e3">${esc(it.region || 'Nova Scotia')} · ${fmtDate(it.start_date)} → ${fmtDate(it.end_date)}</p>
    </div>
    <div style="background:#fffdf9;border:1px solid #e6ded0;border-radius:16px;padding:22px;margin-top:14px">
      <p style="margin:0 0 16px">Here's your trip plan. Open the full interactive page anytime:</p>
      <p style="text-align:center;margin:0 0 22px">
        <a href="${url}" style="display:inline-block;background:linear-gradient(135deg,#f2a83b,#d98324);color:#0a1626;text-decoration:none;font-weight:700;border-radius:11px;padding:13px 26px">Open my full itinerary →</a>
      </p>
      ${see ? `<h3 style="margin:14px 0 6px;color:#0a1626">🏛️ Top attractions</h3><ul style="margin:0;padding-left:18px">${see}</ul>` : ''}
      ${eat ? `<h3 style="margin:16px 0 6px;color:#0a1626">🍽️ Best places to eat</h3><ul style="margin:0;padding-left:18px">${eat}</ul>` : ''}
      ${stay ? `<h3 style="margin:16px 0 6px;color:#0a1626">🛏️ Best places to stay</h3><ul style="margin:0;padding-left:18px">${stay}</ul>` : ''}
    </div>
    <p style="text-align:center;color:#8a97a5;font-size:12px;margin:18px 0 0">
      Nova Scotia Explorer · data from Open Data Nova Scotia &amp; Open-Meteo
    </p>
  </div></body></html>`;
}

/**
 * Email an itinerary to `to`. Returns true if sent, false if email is disabled.
 * Throws on an actual send failure (caller decides whether to surface it).
 */
export async function sendItineraryEmail(to, itinerary, baseUrl = '') {
  if (!isEmailEnabled()) return false;
  if (!to) return false;
  const dates = `${itinerary.start_date} → ${itinerary.end_date}`;
  await getTransporter().sendMail({
    from: `"Nova Scotia Explorer" <${process.env.GMAIL_USER}>`,
    to,
    subject: `Your ${itinerary.destination} itinerary (${dates})`,
    html: buildEmailHtml(itinerary, baseUrl),
  });
  return true;
}
