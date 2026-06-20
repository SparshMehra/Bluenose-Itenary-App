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
src/datasets.js    # Dataset registry + snapshot/fetch IO primitives
src/pipeline.js    # Daily data pipeline (snapshots all datasets, scheduler)
src/nsData.js      # Data layer — serves from daily snapshots (live fallback)
scripts/refresh.js # Standalone refresh runner (npm run refresh-data)
data/cache/        # Daily dataset snapshots + manifest.json (generated)
src/weather.js     # Open-Meteo forecast / historical averages
src/agent.js       # Claude agent (model: claude-opus-4-8) with 5 tools:
                   #   search_destinations, get_weather_outlook,
                   #   get_visitation_by_month, get_top_communities,
                   #   build_itinerary
src/itinerary.js   # Assembles + saves a full itinerary (eat/stay/see + days)
src/itineraryPage.js # Renders the shareable /itinerary/:id HTML page
src/auth.js        # User accounts: scrypt passwords + signed-cookie sessions
src/email.js       # Emails itineraries via Gmail SMTP (nodemailer)
data/itineraries/  # Saved itineraries (one JSON per trip)
data/users.json    # User accounts (generated, git-ignored)
```

## Email itineraries (optional)

When a **logged-in** user creates a trip, the full itinerary is emailed to their
account address automatically; the itinerary page also has an **"Email me a copy"**
button. Email uses Gmail SMTP and is **off until configured** — the app works fine
without it.

To enable:
1. Turn on 2-Step Verification on your Google account.
2. Create an **App Password**: https://myaccount.google.com/apppasswords
3. In `.env`, set `GMAIL_USER` (your address) and `GMAIL_APP_PASSWORD` (the 16-char
   app password — **not** your login password), then restart.

> Gmail SMTP is fine for personal/demo use but has low daily limits and isn't meant
> for production volume — switch to a provider like Resend/SendGrid before scaling.

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
| `GET /api/data-status` | When the open data was last refreshed + per-dataset row counts |

## Live data pipeline (daily refresh)

All four Open Data Nova Scotia datasets are snapshotted to `data/cache/` and
**refreshed automatically every day**, so the app serves fast local copies and
keeps working even if the open-data portal is briefly down.

- **On server start**, it refreshes if the snapshot is older than ~23h, then
  schedules a refresh **daily at 03:00 local time**. After each refresh the
  in-memory cache is cleared, so new data appears **without a restart**.
- The footer shows the last-updated date and total record count.
- Requests fall back to a live Socrata fetch if a snapshot is ever missing.

**Manual refresh** (anytime):
```powershell
npm run refresh-data
```

**If you don't keep the server running 24/7**, schedule the refresh at the OS
level instead (it runs in seconds and exits):

- **Windows (Task Scheduler)** — create a Basic Task → Daily → *Start a program*:
  - Program: `node`
  - Arguments: `scripts/refresh.js`
  - Start in: the project folder (`C:\...\APP T-2`)
- **macOS/Linux (cron)** — `crontab -e`, then:
  ```
  0 3 * * * cd /path/to/APP\ T-2 && /usr/bin/node scripts/refresh.js >> refresh.log 2>&1
  ```

> Snapshots live in `data/` which is git-ignored — they're regenerated, never committed.
> Set an optional `SOCRATA_APP_TOKEN` in `.env` for higher refresh rate limits.
