// Weather via Open-Meteo (free, no API key).
// - Trips starting within the next 16 days: real daily forecast.
// - Trips further out: historical averages for those dates (last 2 years),
//   clearly labelled so the agent can present them as typical conditions.

const WEATHER_CODES = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
  66: 'Freezing rain', 67: 'Heavy freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Light showers', 81: 'Showers', 82: 'Violent showers',
  85: 'Snow showers', 86: 'Heavy snow showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

const DAILY_VARS = 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum';

function daysFromToday(dateStr) {
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000);
}

function shapeDaily(daily, { historical = false } = {}) {
  return (daily.time || []).map((date, i) => ({
    date,
    conditions: WEATHER_CODES[daily.weathercode?.[i]] ?? 'Unknown',
    temp_max_c: daily.temperature_2m_max?.[i],
    temp_min_c: daily.temperature_2m_min?.[i],
    precipitation_mm: daily.precipitation_sum?.[i],
    ...(historical ? { note: 'historical' } : {}),
  }));
}

export async function getWeatherOutlook({ latitude, longitude, start_date, end_date }) {
  const startOffset = daysFromToday(start_date);
  const endOffset = daysFromToday(end_date);

  if (endOffset < 0) {
    return { mode: 'error', message: 'Trip dates are in the past.' };
  }

  // Real forecast covers ~16 days ahead
  if (startOffset <= 15) {
    const clampedEnd = endOffset <= 15 ? end_date
      : new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
      `&daily=${DAILY_VARS},precipitation_probability_max&timezone=America%2FHalifax` +
      `&start_date=${start_date}&end_date=${clampedEnd}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo forecast failed (${res.status})`);
    const data = await res.json();
    const days = (data.daily.time || []).map((date, i) => ({
      date,
      conditions: WEATHER_CODES[data.daily.weathercode?.[i]] ?? 'Unknown',
      temp_max_c: data.daily.temperature_2m_max?.[i],
      temp_min_c: data.daily.temperature_2m_min?.[i],
      precipitation_mm: data.daily.precipitation_sum?.[i],
      precipitation_chance_pct: data.daily.precipitation_probability_max?.[i],
    }));
    return {
      mode: 'forecast',
      message: endOffset > 15 ? 'Forecast shown up to the 16-day limit; later trip days not yet forecastable.' : undefined,
      days,
    };
  }

  // Beyond the forecast window: average the same dates over the last 2 years
  const years = [1, 2];
  const perYear = [];
  for (const back of years) {
    const s = shiftYear(start_date, -back);
    const e = shiftYear(end_date, -back);
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}` +
      `&daily=${DAILY_VARS}&timezone=America%2FHalifax&start_date=${s}&end_date=${e}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      perYear.push(shapeDaily(data.daily, { historical: true }));
    }
  }
  if (!perYear.length) throw new Error('Historical weather lookup failed.');

  const n = Math.min(...perYear.map((d) => d.length));
  const days = [];
  for (let i = 0; i < n; i++) {
    const samples = perYear.map((d) => d[i]);
    const avg = (key) => {
      const vals = samples.map((s) => s[key]).filter((v) => v != null);
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
    };
    const tripDate = addDays(start_date, i);
    days.push({
      date: tripDate,
      typical_conditions: samples.map((s) => s.conditions).join(' / '),
      avg_temp_max_c: avg('temp_max_c'),
      avg_temp_min_c: avg('temp_min_c'),
      avg_precipitation_mm: avg('precipitation_mm'),
    });
  }
  return {
    mode: 'historical_average',
    message: 'Trip is beyond the 16-day forecast window. Showing typical conditions for these dates, averaged from the last 2 years.',
    days,
  };
}

function shiftYear(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Handle Feb 29 safely
  const day = m === 2 && d === 29 ? 28 : d;
  return `${y + delta}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
