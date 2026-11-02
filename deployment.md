# Deployment and configuration

Kirana OrderDesk is a single Next.js app with a SQLite database. Everything except the
optional Gemini call runs locally with no external services.

## Environment variables

Copy `.env.example` to `.env` and fill in values. **`.env` is gitignored and must never be
committed**; `.env.example` holds variable names only.

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | SQLite file, e.g. `file:./dev.db` (relative to `prisma/`) |
| `SESSION_SECRET` | yes | 32+ random characters used to sign the session cookie |
| `GEMINI_API_KEY` | no | Enables AI text-order capture with Google Gemini |
| `GEMINI_VIA_PROXY` | no | `1` = call Gemini without a key header; a trusted egress proxy adds it |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | no | Override model names (see below) |

### Which engine reads text orders

| Configuration | Engine | Label shown to the retailer |
|---------------|--------|-----------------------------|
| `GEMINI_API_KEY` set | Gemini; key sent as the `x-goog-api-key` header | AI (Gemini) + model name |
| `GEMINI_VIA_PROXY=1`, no key | Gemini; **no key header** (proxy injects it) | AI (Gemini) + model name |
| neither | Deterministic offline parser | Offline parser - no AI key configured |

The engine is chosen on the server; the key never reaches the browser. It is never logged,
returned in an API response, stored in the database or printed by the smoke script.

## Setting up Gemini on your machine

1. Create an API key in Google AI Studio.
2. Put it in `.env` (not in `.env.example`, not in code):

   ```
   GEMINI_API_KEY="<your key>"
   ```

3. Restart `npm run dev`. The text-order screen (`/retailer/capture`) now reads
   "Will be read by: AI (Gemini)".
4. Optional live check on the brief's sample message (reads `.env`, prints the HTTP status
   per model and the validated JSON, never the key):

   ```bash
   npx tsx scripts/gemini-smoke.ts
   ```

To rotate or remove the key, edit `.env` and restart. If a key is ever committed by
mistake, revoke it in Google AI Studio immediately; removing it from git history is not
enough.

### Models and fallback

Default order: `gemini-flash-latest`, then `gemini-3.5-flash-lite`. The next model is
tried on HTTP 404 (model retired), 429 (quota) and transient 500/502/503/504; 401/403 fail
immediately. The brief's fallback, `gemini-2.5-flash-lite`, answered 404 for new keys on
2026-11-02 ("no longer available to new users"), so the default fallback is
`gemini-3.5-flash-lite` (verified with this project's key). Either name can still be
overridden without a code change, e.g.:

```
GEMINI_MODEL=<primary model name>
GEMINI_FALLBACK_MODEL=<fallback model name>
```

If the model returns invalid JSON, the app sends one repair prompt; if that fails too,
the capture is recorded as FAILED and the retailer is told plainly. It can then choose
the offline parser explicitly.

### Behind an HTTP egress proxy (`GEMINI_VIA_PROXY=1`)

Some sandboxes and corporate networks route outbound traffic through a proxy that adds
the API key itself. Set `GEMINI_VIA_PROXY=1` and leave `GEMINI_API_KEY` empty. Node's
built-in `fetch` ignores `HTTPS_PROXY` by default, so start Node with
`NODE_USE_ENV_PROXY=1` (Node >= 22.21):

```bash
GEMINI_VIA_PROXY=1 NODE_USE_ENV_PROXY=1 npm run dev
```

## Production build

```bash
npm ci
```

```bash
npx prisma migrate deploy
```

```bash
npm run build
```

```bash
npm start
```

Seed demo data with `npm run db:seed` only on demo environments.

Next's built-in response compression is turned off (`next.config.ts`): its gzip of
streamed RSC responses made Chromium abort some client-side navigations. Put the app
behind a reverse proxy or CDN that compresses (gzip or brotli); that matters for
retailers on slow 3G.

## Data notes

- The Gemini request contains the pasted message and the catalogue's SKU codes, names and
  brands only (ASSUMPTIONS.md A17).
- Every capture is stored in `AICapture` with the raw text, the full parsed JSON, the engine
  and model, and the outcome (confirmed order and corrections) or the failure reason.
- GST rates in the seed are demo values (ASSUMPTIONS.md A13).
- Tally export is mocked (ASSUMPTIONS.md A8, A28): each export's CSV is stored in
  `TallyExport.csvPayload` and downloaded by the browser; nothing is sent to a Tally server.
  Desk "today" counters and the bulk export use IST day boundaries (A24), independent of the
  server's time zone.
