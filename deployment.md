# Deployment and configuration

Kirana OrderDesk is a single Next.js app with a SQLite database. Everything except the
optional Gemini call runs locally with no external services.

## Run it locally, step by step

1. **Node.js 20 or newer** (tested on Node 22) and npm. Check with:

   ```bash
   node -v
   ```

2. **Install dependencies** (also generates the Prisma client):

   ```bash
   npm install
   ```

3. **Create `.env`** from the template, then fill in the values on your machine:

   ```bash
   cp .env.example .env
   ```

   | Variable | Required | What to put there |
   |----------|----------|-------------------|
   | `DATABASE_URL` | yes | a SQLite file path, for example `file:./dev.db` (relative to `prisma/`) |
   | `SESSION_SECRET` | yes | any random string of 32+ characters |
   | `GEMINI_API_KEY` | no | your own Google AI Studio key; leave empty to use the offline parser |

   One way to generate a session secret:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   `.env` is gitignored. Never commit it, and never put real values in `.env.example`.

4. **Create the database and load demo data.** `migrate dev` applies every migration and
   runs the seed on a fresh database:

   ```bash
   npx prisma migrate dev
   ```

   The seed is deterministic and idempotent; run it again any time to reset demo data:

   ```bash
   npm run seed
   ```

5. **Start the app** at http://localhost:3000:

   ```bash
   npm run dev
   ```

6. **Log in.** The OTP is always `123456` (mocked, nothing is sent).

   | Role | Phone | Lands on |
   |------|-------|----------|
   | Retailer, Agrawal Kirana Stores (healthy credit) | `9827000001` | `/retailer/catalogue` |
   | Retailer, Irfan Provision Store (over credit limit) | `9827000003` | `/retailer/catalogue` |
   | Retailer, Shri Ram Kirana (has the AI-captured demo order) | `9827000004` | `/retailer/catalogue` |
   | Order desk, Neha Sharma | `9000000001` | `/desk` |

   The full list is in the README.

7. **Run the tests** (unit + integration; integration tests create and reset their own
   `prisma/test.db`, never touching `dev.db`):

   ```bash
   npm test
   ```

   Type-check, lint and a production build:

   ```bash
   npm run typecheck
   ```

   ```bash
   npm run lint
   ```

   ```bash
   npm run build
   ```

A clean-slate check that everything works from scratch:

```bash
rm -rf node_modules .next && npm install && npx prisma migrate dev && npm run seed && npm test && npm run build
```

## What is mocked, and how

Nothing in the demo talks to an outside system except the optional Gemini call.

| External system | In this demo | Where | To make it real |
|-----------------|--------------|-------|-----------------|
| **OTP SMS** | `MockOtpProvider` accepts the fixed code `123456` for any registered number, and the login screen shows it. No SMS is sent. | `lib/otp/otp-provider.ts` (A7) | Implement `OtpProvider` with an SMS gateway; add attempt limits and expiry |
| **WhatsApp** | Retailers paste their WhatsApp-style message into **Text order**; there is no WhatsApp API connection. | `/retailer/capture` | A WhatsApp Business webhook calling the same capture pipeline |
| **Tally** | *Export to Tally* builds a Tally-style CSV, stores it in `TallyExport.csvPayload` and downloads it in the browser. Nothing is sent to a Tally server. | `lib/desk/tally.ts` (A8, A28) | Tally XML import over its HTTP port, or a connector |
| **Gemini (optional)** | Real API call when `GEMINI_API_KEY` is set; otherwise a deterministic offline parser, labeled as such in the UI. | `lib/ai-capture.ts` | Already real; see below |

## All environment variables

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

### Live verification script (`scripts/verify-live-ai.ts`)

Runs the live Gemini path end to end, free tier only. It reads the key from the
`GEMINI_API_KEY` environment variable (or `.env`, which is gitignored); the key is sent only
as the `x-goog-api-key` header and is never printed or written anywhere.

What it does, in at most **8 API calls** per run:

1. lists the models available to the key that support `generateContent` (names only, 1 call);
2. sends one tiny prompt ("Reply with exactly one word: pong") and prints the reply (1 call);
3. runs the app's real capture service (`parseCapture` in `lib/capture/service.ts`) on three
   free-text orders (English, Hinglish, Hindi in Devanagari) for the seeded retailer
   Agrawal Kirana Stores, and prints the engine, model and parsed lines as JSON for each
   (1 call per order, plus at most 1 repair retry).

Model: `GEMINI_MODEL` if set; otherwise `gemini-3.5-flash-lite` (flash-lite free tier is about
500 requests/day and 15 per minute, against about 20/day for non-lite flash). If that name is
not listed for the key, the newest listed flash-lite model is used. If no flash-lite model is
listed, the script stops (exit 4) and asks you to choose with `GEMINI_MODEL`; it does not
pick a non-lite model by itself. A run uses one model only (no fallback to another model).

Run it from a clean checkout:

```bash
npm ci
```

```bash
cp .env.example .env
```

Set `DATABASE_URL="file:./dev.db"` and `SESSION_SECRET` in `.env` as in the quick start, and
add `GEMINI_API_KEY="<your key>"` there (or export it in your shell instead). Then:

```bash
npx prisma migrate deploy
```

```bash
npm run seed
```

```bash
npm run verify:ai
```

To pin a model for one run:

```bash
GEMINI_MODEL=gemini-3.5-flash-lite npm run verify:ai
```

Without any key or network, the same three orders through the offline parser (fetch is
disabled in this mode):

```bash
npm run verify:ai -- --offline
```

Exit codes: `0` all orders read by the selected engine, `1` other failure, `2`
`GEMINI_API_KEY` missing (nothing is called), `3` quota, billing or permission error (the
exact API message is printed; keep using the offline parser), `4` no flash-lite model
listed and `GEMINI_MODEL` not set. Step 3 stores PARSED captures in the local database like
the app does; it never places an order. To stay at zero cost, use an AI Studio key from a
project **without billing enabled**: then usage over the free quota is refused (HTTP 429),
not charged.

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
