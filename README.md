# 🦞 Nova Scotia Tourist Explorer

A tourist web app with an AI travel agent ("Bluenose") that plans Nova Scotia trips using **real open data**:

| What | Source |
|---|---|
| Tourist destinations / attractions (with GPS coords) | [Open Data NS — Tourism Listed Operators](https://data.novascotia.ca/resource/2h2s-6bg4) |
| Monthly tourist counts (seasonality → best dates) | [Open Data NS — Tourism Visitation](https://data.novascotia.ca/resource/n783-4gmh) |
| Community popularity (% of visitors who went there) | [Open Data NS — Visitor Exit Survey, Communities](https://data.novascotia.ca/resource/is4a-t3qd) |
| Weather forecast (16-day) + historical averages | [Open-Meteo](https://open-meteo.com) (free, no key) |

## What it does

1. You tell the app **where** you want to go and **what dates** (search form or free chat).
2. The AI agent (Claude, via the Anthropic API) calls tools that query the datasets above.
3. The agent builds a **full shareable itinerary** and replies with a one-click link:
   - **Best places to eat** and **best places to stay** near your destination, ranked by real distance, each with a **map link** and a **live "Reviews ↗" link**
   - **Top attractions & outdoor activities** nearby
   - A **day-by-day plan** with the weather for each day
   - **Best recommended dates** — peak vs shoulder season from actual monthly visitor counts
   - Opens at `/itinerary/:id` — a polished, printable page you can bookmark or share

If the agent doesn't have your destination or dates yet, it asks for them first — exactly the guided flow you'd expect from a travel agent.

> **On reviews:** the Open Data Nova Scotia dataset has **no rating/review field**, so rather than invent scores, each place links out to a live Google reviews search — real ratings, nothing fabricated.

## Setup

```powershell
npm install
copy .env.example .env   # then paste your Anthropic API key into .env
npm start
```

Open http://localhost:3000

**No API key?** The app still works in **demo mode**: the search form produces a data-driven recommendation (spots + weather + best dates) without the conversational AI. Set `ANTHROPIC_API_KEY` in `.env` to unlock full AI chat.

## Architecture

```
public/            # the website (vanilla HTML/CSS/JS):
                   #   hero + live stats strip, destination directory with
                   #   search/region/type filters, region cards, monthly
                   #   visitation chart, trip planner form, and a floating
                   #   AI chat widget available on every section
server.js          # Express server + REST endpoints
src/nsData.js      # Socrata (Open Data NS) queries + 1h cache
src/weather.js     # Open-Meteo forecast / historical averages
src/agent.js       # Claude agent (model: claude-opus-4-8) with 5 tools:
                   #   search_destinations, get_weather_outlook,
                   #   get_visitation_by_month, get_top_communities,
                   #   build_itinerary
src/itinerary.js   # Assembles + saves a full itinerary (eat/stay/see + days)
src/itineraryPage.js # Renders the shareable /itinerary/:id HTML page
data/itineraries/  # Saved itineraries (one JSON per trip)
```

The agent uses a manual tool-use loop (`stop_reason === "tool_use"`), adaptive thinking, and prompt caching on the system prompt.

## API endpoints

| Endpoint | Description |
|---|---|
| `POST /api/chat` | `{messages:[{role,content}], meta?}` → AI (or demo) reply |
| `GET /api/destinations?q=...` | Search attractions (autocomplete) |
| `GET /api/regions` | List tourism regions |
| `GET /api/types` | List operator types |
| `GET /api/summary` | Totals + counts per region/type |
| `GET /api/visitation` | Monthly visitor stats |
| `GET /api/popular?region=...` | Most-visited communities |
| `GET /api/status` | Whether AI mode is enabled |
| `POST /api/itinerary` | `{destination,start_date,end_date}` → builds + saves an itinerary |
| `GET /itinerary/:id` | Full shareable itinerary page (HTML) |
