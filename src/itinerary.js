// Itinerary builder + store.
// Gathers everything for a trip in one shot — attractions, outdoor
// activities, restaurants (Eat & Drink) and hotels (Accommodation) near the
// destination (ranked by real distance), weather for the dates, and
// seasonality — then saves it under an id so /itinerary/:id can render it.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { searchDestinations, getVisitationByMonth, getCommunityPopularity } from './nsData.js';
import { getWeatherOutlook } from './weather.js';
import { getUserById } from './auth.js';
import { sendItineraryEmail, isEmailEnabled } from './email.js';

const BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

const STORE_DIR = path.join(process.cwd(), 'data', 'itineraries');

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}

function withLinks(spot, anchor) {
  const place = `${spot.name} ${spot.region || ''} Nova Scotia`.trim();
  return {
    ...spot,
    distance_km: anchor ? haversineKm(anchor.latitude, anchor.longitude, spot.latitude, spot.longitude) : null,
    // Map pin at the exact coordinates.
    maps_url: `https://www.google.com/maps/search/?api=1&query=${spot.latitude},${spot.longitude}`,
    // Google Maps place search by name → opens the place card with star ratings & reviews.
    reviews_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`,
  };
}

function nearest(list, anchor, n) {
  return list
    .map((s) => withLinks(s, anchor))
    .sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))
    .slice(0, n);
}

function normalizeWeatherDays(wx) {
  const byDate = {};
  for (const d of wx?.days || []) {
    byDate[d.date] = wx.mode === 'forecast'
      ? { summary: d.conditions, tmax: d.temp_max_c, tmin: d.temp_min_c, precip_mm: d.precipitation_mm, chance_pct: d.precipitation_chance_pct, historical: false }
      : { summary: d.typical_conditions, tmax: d.avg_temp_max_c, tmin: d.avg_temp_min_c, precip_mm: d.avg_precipitation_mm, chance_pct: null, historical: true };
  }
  return byDate;
}

function dateRange(start, end, cap = 14) {
  const out = [];
  const d = new Date(start + 'T00:00:00');
  const stop = new Date(end + 'T00:00:00');
  while (d <= stop && out.length < cap) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export async function buildItinerary({ destination, start_date, end_date, notes = '', ownerId = null }) {
  if (!destination || !start_date || !end_date) {
    throw new Error('destination, start_date and end_date are required');
  }

  // Anchor the trip: the best match for what the user typed gives us
  // coordinates + region to search around.
  const anchorMatches = await searchDestinations({ query: destination, limit: 1 });
  const anchor = anchorMatches[0];
  if (!anchor) throw new Error(`No listed spot matched "${destination}". Try a community or region name.`);
  const region = (anchor.region || '').split(',')[0].trim();

  // Everything in the region, ranked by real distance from the anchor.
  const [regionAttractions, regionActivities, regionFood, regionHotels, namedSpots, popular, visitation, weather] =
    await Promise.all([
      searchDestinations({ region, type: 'Attraction', limit: 400 }),
      searchDestinations({ region, type: 'Outdoor', limit: 400 }),
      searchDestinations({ region, type: 'Eat & Drink', limit: 400 }),
      searchDestinations({ region, type: 'Accommodation', limit: 400 }),
      searchDestinations({ query: destination, limit: 30 }),
      getCommunityPopularity({ community: destination, limit: 3 }),
      getVisitationByMonth(),
      getWeatherOutlook({ latitude: anchor.latitude, longitude: anchor.longitude, start_date, end_date }).catch(() => null),
    ]);

  // Prefer name-matched attractions first, then fill with nearest in region.
  const namedAttr = namedSpots.filter((s) => /attraction/i.test(s.type)).map((s) => withLinks(s, anchor));
  const attractions = [
    ...namedAttr,
    ...nearest(regionAttractions.filter((s) => !namedAttr.some((n) => n.name === s.name)), anchor, 12),
  ].slice(0, 12);
  const activities = nearest(regionActivities, anchor, 8);
  const restaurants = nearest(regionFood, anchor, 8);
  const hotels = nearest(regionHotels, anchor, 8);

  // Day-by-day plan: rotate attractions/activities, dinner spot per day.
  const wxByDate = normalizeWeatherDays(weather);
  const days = dateRange(start_date, end_date).map((date, i) => ({
    date,
    weather: wxByDate[date] || null,
    morning: attractions[(i * 2) % Math.max(attractions.length, 1)] || null,
    afternoon:
      (i % 2 === 0 && activities.length ? activities[i % activities.length] : attractions[(i * 2 + 1) % Math.max(attractions.length, 1)]) || null,
    dinner: restaurants[i % Math.max(restaurants.length, 1)] || null,
  }));

  // Seasonality verdict
  const ranked = [...visitation.averageByCalendarMonth].sort((a, b) => b.avg_visitors - a.avg_visitors);
  const tripMonth = new Date(start_date + 'T00:00:00').toLocaleString('en-CA', { month: 'long' });
  const season = {
    peak_months: ranked.slice(0, 3).map((m) => m.month),
    shoulder_months: ranked.slice(3, 6).map((m) => m.month),
    trip_month: tripMonth,
    trip_month_rank: ranked.findIndex((m) => m.month === tripMonth) + 1,
  };

  const itinerary = {
    id: randomUUID().slice(0, 8),
    created_at: new Date().toISOString(),
    ownerId,
    destination,
    region,
    start_date,
    end_date,
    notes,
    anchor: { name: anchor.name, latitude: anchor.latitude, longitude: anchor.longitude },
    popularity: popular[0] || null,
    weather_mode: weather?.mode || 'unavailable',
    weather_note: weather?.message || null,
    days,
    attractions,
    activities,
    restaurants,
    hotels,
    season,
  };

  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(path.join(STORE_DIR, `${itinerary.id}.json`), JSON.stringify(itinerary, null, 2));

  // Auto-email the itinerary to the logged-in owner (best-effort, non-fatal).
  let emailedTo = null;
  if (ownerId && isEmailEnabled()) {
    const user = getUserById(ownerId);
    if (user?.email) {
      try {
        await sendItineraryEmail(user.email, itinerary, BASE_URL);
        emailedTo = user.email;
      } catch (err) {
        console.error('[email] failed to send itinerary:', err.message);
      }
    }
  }

  return { ...itinerary, url: `/itinerary/${itinerary.id}`, emailedTo };
}

export async function getItinerary(id) {
  if (!/^[a-f0-9-]{4,40}$/i.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(STORE_DIR, `${id}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** List saved itineraries belonging to a user, newest first (lightweight fields). */
export async function listItinerariesByOwner(ownerId) {
  if (!ownerId) return [];
  let files = [];
  try {
    files = (await fs.readdir(STORE_DIR)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const f of files) {
    try {
      const it = JSON.parse(await fs.readFile(path.join(STORE_DIR, f), 'utf8'));
      if (it.ownerId === ownerId) {
        out.push({
          id: it.id,
          destination: it.destination,
          region: it.region,
          start_date: it.start_date,
          end_date: it.end_date,
          created_at: it.created_at,
          url: `/itinerary/${it.id}`,
        });
      }
    } catch { /* skip unreadable */ }
  }
  out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return out;
}
