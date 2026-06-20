// AI travel agent for Nova Scotia.
// Uses the Anthropic SDK with a manual tool-use loop. If no ANTHROPIC_API_KEY
// is configured, falls back to a rule-based recommendation built from the
// same open data, so the app still works in demo mode.

import Anthropic from '@anthropic-ai/sdk';
import { searchDestinations, getVisitationByMonth, getCommunityPopularity } from './nsData.js';
import { getWeatherOutlook } from './weather.js';
import { buildItinerary } from './itinerary.js';
import { parseTripFromMessages } from './parse.js';

const MODEL = 'claude-opus-4-8';

const TOOLS = [
  {
    name: 'search_destinations',
    description:
      'Search the Open Data Nova Scotia tourism operators dataset for attractions, accommodations and tourist spots. ' +
      'Call this when the user names a place, region or kind of attraction in Nova Scotia, to find real listed spots with GPS coordinates. ' +
      'Regions include: Halifax Metro, Bay of Fundy and Annapolis Valley, South Shore, Yarmouth and Acadian Shores, ' +
      'Northumberland Shore, Eastern Shore, Cape Breton Island.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Place or attraction name to search for, e.g. "Peggys Cove", "Lunenburg", "winery"' },
        region: { type: 'string', description: 'Optional tourism region filter' },
        type: { type: 'string', description: 'Optional type filter, e.g. "Attraction", "Accommodation", "Outfitter"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather_outlook',
    description:
      'Get the daily weather for a destination and date range. Returns a real forecast when the trip is within 16 days, ' +
      'otherwise typical conditions averaged from recent years. Call this once you know the destination coordinates and travel dates.',
    input_schema: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['latitude', 'longitude', 'start_date', 'end_date'],
    },
  },
  {
    name: 'get_visitation_by_month',
    description:
      'Get Nova Scotia monthly tourist counts (Open Data NS visitation dataset): average visitors per calendar month across years, ' +
      'plus the most recent 24 months. Call this to judge peak vs quiet season and to recommend the best dates to travel.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_top_communities',
    description:
      'Get how popular Nova Scotia communities are with overnight visitors (exit survey, % of visitors who went there). ' +
      'Call this to rank tourist spots by popularity or to check how visited a specific community/region is.',
    input_schema: {
      type: 'object',
      properties: {
        community: { type: 'string', description: 'Optional community name filter' },
        region: { type: 'string', description: 'Optional region filter' },
      },
    },
  },
  {
    name: 'build_itinerary',
    description:
      'Build and SAVE a complete, shareable day-by-day Nova Scotia itinerary for a destination and date range. ' +
      'This automatically gathers the best nearby attractions, outdoor activities, restaurants (best places to eat) and ' +
      'hotels (best places to stay) — each with a map link and a reviews link — plus the weather for every day and seasonality advice. ' +
      'Call this ONCE you know the destination and both travel dates. It returns a "url" you MUST give the user as a clickable link ' +
      'to open the full itinerary page. Prefer this over calling the other tools separately when the user wants a trip planned.',
    input_schema: {
      type: 'object',
      properties: {
        destination: { type: 'string', description: 'Community or area in Nova Scotia, e.g. "Lunenburg", "Cabot Trail"' },
        start_date: { type: 'string', description: 'Trip start date, YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Trip end date, YYYY-MM-DD' },
        notes: { type: 'string', description: 'Optional traveller preferences to record on the itinerary' },
      },
      required: ['destination', 'start_date', 'end_date'],
    },
  },
];

const SYSTEM_PROMPT = `You are "Bluenose", a friendly Nova Scotia travel planner built into a tourist app.
Today's date is ${new Date().toISOString().slice(0, 10)}.

Your data sources are real Open Data Nova Scotia datasets (tourism operators, monthly visitor counts, visitor exit surveys) and Open-Meteo weather, available through your tools.

Conversation flow:
1. If the user has not yet told you BOTH a destination (or area of interest) and their travel dates, ask for whichever is missing — one short, friendly question. Do not call tools yet.
2. Once you have destination + dates, call build_itinerary(destination, start_date, end_date). This single tool assembles the best nearby attractions, the best restaurants to eat at, the best hotels to stay in (each with map + reviews links), the weather for every day, and seasonality — and saves a shareable itinerary page.
3. Then reply with a SHORT summary (warm, a few lines):
   - Confirm the trip and name 2-3 highlight spots, the top restaurant, and the top hotel it found.
   - One line on the weather window and whether the dates are a good time to go (peak vs shoulder season).
   - End your message with EXACTLY this line, using the url returned by build_itinerary:
     **✅ Your itinerary is planned — [Open your full itinerary →](THE_URL)**
   Replace THE_URL with the real "url" value from the tool result. Do not omit this link.
4. For follow-up questions you may use the other tools (search_destinations, get_weather_outlook, etc.) directly without rebuilding the whole itinerary.

Style: warm, concise, markdown. Use °C. Never invent places — only use what the tools return. If build_itinerary errors (no match), say so and suggest a nearby community or region.`;

let client = null;
export function hasApiKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

async function executeTool(name, input, ctx = {}) {
  switch (name) {
    case 'search_destinations':
      return searchDestinations(input);
    case 'get_weather_outlook':
      return getWeatherOutlook(input);
    case 'get_visitation_by_month':
      return getVisitationByMonth();
    case 'get_top_communities':
      return getCommunityPopularity(input ?? {});
    case 'build_itinerary':
      return buildItinerary({ ...input, ownerId: ctx.ownerId ?? null }); // tag owner if logged in
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Run one agent turn. `messages` is the prior conversation:
 * [{ role: 'user'|'assistant', content: string }, ...]
 * `ctx.ownerId` (optional) tags any itinerary the agent builds to that user.
 * Returns the assistant's final text.
 */
export async function chat(messages, ctx = {}) {
  const anthropic = getClient();
  const convo = messages.map((m) => ({ role: m.role, content: m.content }));

  for (let iteration = 0; iteration < 8; iteration++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages: convo,
    });

    if (response.stop_reason === 'tool_use') {
      convo.push({ role: 'assistant', content: response.content });
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        let result;
        let isError = false;
        try {
          result = await executeTool(block.name, block.input, ctx);
        } catch (err) {
          result = `Error: ${err.message}`;
          isError = true;
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
          ...(isError ? { is_error: true } : {}),
        });
      }
      convo.push({ role: 'user', content: toolResults });
      continue;
    }

    if (response.stop_reason === 'pause_turn') {
      convo.push({ role: 'assistant', content: response.content });
      continue;
    }

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return text || 'Sorry, I could not generate a response.';
  }
  return 'Sorry, I hit my tool-use limit while researching. Please try again.';
}

/**
 * Rule-based fallback used when no Anthropic API key is configured.
 * Understands free-text chat (via parseTripFromMessages) AND the form's
 * structured meta, then builds the same full itinerary + link.
 *
 * @param {object} meta      optional { destination, start_date, end_date } from the form
 * @param {Array}  messages  the chat history [{role, content}, ...]
 * @param {string} ownerId   optional logged-in user id to tag the itinerary
 */
export async function fallbackRecommend(meta = {}, messages = [], ownerId = null) {
  const { destination, start_date, end_date } = parseTripFromMessages(messages, meta);

  // Ask only for what's still missing — like a real agent would.
  if (!destination && !start_date) {
    return 'Sure! Tell me **where** in Nova Scotia you\'d like to go and **roughly when** — e.g. _"Peggy\'s Cove on June 20"_ or _"Cape Breton, Aug 10–15"_.';
  }
  if (!destination) {
    return 'Got your dates! 📅 Which place in Nova Scotia would you like to visit? (e.g. **Peggy\'s Cove**, **Lunenburg**, or **Cape Breton**)';
  }
  if (!start_date) {
    return `Great — **${escapeName(destination)}** it is! 🗺️ What dates are you thinking? (e.g. _"June 20"_ or _"Aug 10–15"_)`;
  }

  let it;
  try {
    it = await buildItinerary({ destination, start_date, end_date, ownerId });
  } catch (err) {
    return `I couldn't find **${escapeName(destination)}** in the Nova Scotia tourism data. Try a nearby community or a region name like **Cape Breton**, **Halifax** or **Lunenburg**. _(${err.message})_`;
  }

  const lines = [`## Your Nova Scotia trip: ${escapeName(it.destination)}`];
  lines.push(`_${it.region} · ${it.start_date} → ${it.end_date}_\n`);

  const topAttractions = it.attractions.slice(0, 3).map((s) => s.name);
  if (topAttractions.length) lines.push(`**Top sights:** ${topAttractions.join(', ')}`);
  if (it.restaurants[0]) lines.push(`**Best place to eat:** ${it.restaurants[0].name} (${it.restaurants[0].distance_km} km away)`);
  if (it.hotels[0]) lines.push(`**Best place to stay:** ${it.hotels[0].name} (${it.hotels[0].distance_km} km away)`);
  if (it.popularity) lines.push(`\n${it.popularity.community} was visited by **${it.popularity.percent_of_visitors}%** of overnight visitors (${it.popularity.survey_year} exit survey).`);

  const r = it.season.trip_month_rank;
  const verdict = r <= 3 ? 'peak season — lively but busy, book early' : r <= 6 ? 'shoulder season — quieter and good value' : 'off season — quieter, but check that spots are open';
  lines.push(`\nYour dates fall in **${it.season.trip_month}** (#${r} busiest month) — ${verdict}.`);

  lines.push(`\n**✅ Your itinerary is planned — [Open your full itinerary →](${it.url})**`);
  lines.push(`\n_It includes the best restaurants, hotels, attractions and a day-by-day plan with map & reviews links._`);
  if (it.emailedTo) lines.push(`\n📧 _A copy has been emailed to **${escapeName(it.emailedTo)}**._`);
  return lines.join('\n');
}

function escapeName(s) {
  return String(s || '').replace(/[<>]/g, '');
}
