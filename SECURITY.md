# Security

## What protects the running app (in code — done ✓)

| Area | Protection |
|---|---|
| **Secrets** | `.env` is git-ignored and was **never committed** (verified against full git history). Only `.env.example` with a placeholder is tracked. |
| **HTTP headers** | Content-Security-Policy (no third-party scripts), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP. Express `X-Powered-By` fingerprint removed. |
| **Rate limiting** | Per-IP, in-memory: 120 req/min globally, 20 req/min on write/AI endpoints (`/api/chat`, `/api/itinerary`). Returns `429` with `Retry-After`. |
| **Input validation** | Chat messages bounded (≤40 msgs, role must be user/assistant, ≤4000 chars each). Dates must be `YYYY-MM-DD`. Strings trimmed + length-capped. Search `limit` clamped to 1–200. JSON body capped at 64 KB. |
| **Path traversal** | `/itinerary/:id` only accepts ids matching `^[a-f0-9-]{4,40}$` — `../`, encoded slashes, and shell metacharacters all return `404`. |
| **Dependencies** | Only 3 runtime deps (express, dotenv, @anthropic-ai/sdk); security middleware is in-house (no extra supply-chain risk). `npm audit`: 0 vulnerabilities. |
| **Output escaping** | All user/data values are HTML-escaped before rendering (chat bubbles and the itinerary page); chat links are restricted to `http(s)`/relative URLs. |

Re-run the checks anytime:
```powershell
npm audit            # dependency vulnerabilities
git log --all -- .env   # must print nothing (no secret ever committed)
```

## "No one can edit my app without forking" — GitHub setup (you do this)

This guarantee is **repository permissions**, not app code. Do these once on GitHub:

1. **Push this repo to GitHub** (keep it the single source of truth):
   ```powershell
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. **Don't add collaborators** with write access. Anyone who isn't a collaborator *cannot* push to your repo — they can only **fork** it and edit their own copy, then open a Pull Request you approve. That is exactly the "fork first" model.
3. **Turn on Branch Protection** for `main`
   (GitHub → Settings → Branches → Add branch ruleset):
   - ✅ Require a pull request before merging
   - ✅ Require approvals (1+)
   - ✅ Block force pushes
   - ✅ Restrict deletions
   - (optional) ✅ Require status checks / signed commits
4. **Enable secret scanning & Dependabot** (GitHub → Settings → Code security): free, auto-alerts if a key is ever pushed or a dependency becomes vulnerable.

After this, the only way an outsider can change your app is: fork → edit their fork → open a PR → **you** approve and merge. Your `main` is untouchable without your sign-off.

## If the leaked key wasn't rotated yet

The Anthropic key pasted into chat earlier should be **revoked**: console.anthropic.com → API Keys → delete it. Keys belong only in `.env`, never in chat or commits.
