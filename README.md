# Kirana OrderDesk

Retailer ordering web app for an FMCG distributor in Jabalpur serving ~1,800 kirana
shops through 18 salesmen. Retailers see the catalogue with live stock, their dealer
price and the current scheme, and order in a minute; the order desk reviews orders,
manages credit holds and exports to Tally (mocked). Retailers can also paste a WhatsApp-style
Hinglish text order; AI (or an offline parser) turns it into lines that the retailer checks
and confirms.

Business assumptions are recorded in [ASSUMPTIONS.md](./ASSUMPTIONS.md); configuration and
the optional Gemini key are covered in [deployment.md](./deployment.md).

## Stack

- Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS
- Prisma 6 + SQLite (`prisma/dev.db`) — no external services needed
- Vitest for unit tests, zod for input validation
- External systems are mocked behind interfaces (`lib/otp/otp-provider.ts`; WhatsApp and Tally later)
- Optional Google Gemini for text-order capture (`lib/ai-capture.ts`); without a key a deterministic
  offline parser is used and labeled as such

## Run locally

Requires Node.js 20+ and npm.

```bash
npm install
```

```bash
cp .env.example .env
```

Fill in `.env` (values are local-only and never committed):

```
DATABASE_URL="file:./dev.db"
SESSION_SECRET="<any random string of 32+ characters>"
```

Optionally add `GEMINI_API_KEY` to enable AI text-order capture (see [deployment.md](./deployment.md)).
Without it, everything works with the offline parser.

One way to generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Create the database and seed it (`migrate dev` runs the seed automatically on a fresh database):

```bash
npx prisma migrate dev
```

To re-seed at any time (the seed is idempotent and deterministic):

```bash
npm run db:seed
```

Start the app at http://localhost:3000:

```bash
npm run dev
```

Other scripts:

| Command | What it does |
|---------|--------------|
| `npm test` | Run unit + integration tests (Vitest; integration tests use a throwaway `prisma/test.db`, never `dev.db`) |
| `npm run build` | Generate Prisma client and build for production |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm run db:reset` | Drop, re-migrate and re-seed the database |

## Demo logins

Login is phone number + OTP. **The OTP is always `123456`** (mocked, see A7); no SMS is sent.

| Role | Name / shop | Phone | Notes |
|------|-------------|-------|-------|
| ORDER_DESK | Neha Sharma | `9000000001` | |
| ORDER_DESK | Rohit Verma | `9000000002` | |
| RETAILER | Agrawal Kirana Stores (Ramesh Agrawal), Napier Town | `9827000001` | Healthy credit |
| RETAILER | Jain General Store (Sunita Jain), Wright Town | `9827000002` | Near credit limit |
| RETAILER | Irfan Provision Store (Mohd. Irfan), Gorakhpur | `9827000003` | Over credit limit |
| RETAILER | Shri Ram Kirana (Pradeep Yadav), Adhartal | `9827000004` | |
| RETAILER | Soni Kirana & General (Kavita Soni), Ranjhi | `9827000005` | No outstanding |
| RETAILER | Patel Super Bazaar (Rajesh Patel), Vijay Nagar | `9827000006` | Large limit |
| RETAILER | Maa Narmada Traders (Anil Tiwari), Garha | `9827000007` | Rs 10 available |
| RETAILER | Gupta Kirana Bhandar (Deepak Gupta), Madan Mahal | `9827000008` | |
| RETAILER | Khan Daily Needs (Shabana Khan), Ghamapur | `9827000009` | |
| RETAILER | Chourasia Kirana Store (Vikas Chourasia), Sadar | `9827000010` | |

`/retailer/*` is reachable only by RETAILER sessions and `/desk/*` only by ORDER_DESK
sessions (`middleware.ts`); other roles are redirected to their own home, anonymous
users to `/login`.

## Retailer flows (chunk 2)

Log in as a retailer (e.g. `9827000001`, OTP `123456`):

- **Catalogue** (`/retailer/catalogue`): dealer price per case of N, labeled *excl. GST*; stock status
  (In stock / Low stock under 20 cases / Out of stock); scheme badge. Search matches name, brand, code,
  category and aliases (distributor-wide plus the retailer's own, including Devanagari, e.g. `चाय पत्ती`).
  Out-of-stock items stay visible but cannot be added.
- **Cart** (`/retailer/cart`): quantities in cases; every line is priced by the server with the scheme
  engine and shows "+1 case FREE" or "3% slab applied", gross, discount, subtotal, GST and line total.
  The browser stores only SKU ids and quantities, so prices are always current.
- **Checkout** (`/retailer/checkout`): credit impact (used, available, this order, remaining). Over the
  limit, the order is still created, **ON_HOLD**, with "sent to desk for credit approval" (A9).
  If stock is short, the retailer sees what can be supplied and must explicitly accept it (A12).
- **My orders** (`/retailer/orders`): status badges and totals; detail page with lines, free cases,
  GST breakup by rate and status history.
- **Hindi / English** toggle in the header (`lib/i18n.ts`); English by default.

Order creation (`lib/orders/create-order.ts`) runs in one transaction: re-read stock and schemes,
price, decide credit, decrement stock by ordered + free cases with a conditional update that never
goes negative (A4, A11), reserve credit for non-held orders (A10), write the order, its lines and the
first status event. It is idempotent per `clientRequestId`, so a double tap on a slow network creates
one order.

## AI order capture from text (chunk 3)

Log in as a retailer and open **Text order** (`/retailer/capture`). Paste a message or tap
**Use sample message** ("bhaiya 5 peti biscuit chhota, 2 peti washing powder 1 kilo, chai patti
250 wala 1 peti") and **Read my order**.

1. **Extraction** (`lib/ai-capture.ts`): `GeminiProvider` asks Gemini for strict JSON
   `[{raw_phrase, qty, unit_hint, sku_guess}]`, validated with zod; invalid output gets one repair
   prompt, then an honest failure (no guessed lines). `OfflineParserProvider` is used when no key is
   configured: it splits the message, reads Hindi/English/Devanagari numbers (5, paanch, do, दो) and
   units (peti/case = cases; dabba/packet/piece = pieces). The screen always says which engine read
   the message: "AI (Gemini)" (+ model) or "Offline parser - no AI key configured".
2. **Matching** (`lib/sku-matcher.ts`): retailer aliases, then distributor aliases, then fuzzy name
   match (Levenshtein on normalized tokens), adjusted for pack size, the AI's guess and this
   retailer's order history. Confidence high/medium/low is a documented heuristic, **not a
   probability** (A14); each line offers two alternatives.
3. **Review** (one card per line): the retailer's original words, the matched SKU or "could not
   match" (fix by manual search), confidence badge, two tap-to-swap alternatives, stock flags, an
   explicit "cases or pieces?" question when the unit is unclear, quantity editing and remove.
   Nothing is ordered until every line is answered and the retailer confirms.
4. **Confirm** (`lib/capture/service.ts`): the order is created with source `AI_TEXT` through the
   same `createRetailerOrder` transaction as checkout (stock, schemes, credit hold, short-confirm).
   In the same transaction the `AICapture` record (raw text, full parsed JSON, engine/model) is marked
   confirmed with its outcome, and each line is learned as a retailer alias (`CONFIRMED`, or
   `CORRECTED` when the retailer picked another SKU). Next time a "learned" hint shows.

Hard rules are enforced on the server too: a confirmation must account for every parsed line
(confirmed or removed) and carry the unit answer wherever one was asked.

Live check of the Gemini path: `npx tsx scripts/gemini-smoke.ts` (needs `GEMINI_API_KEY` or
`GEMINI_VIA_PROXY=1`; prints HTTP status and parsed JSON, never the key).

## Project structure

```
app/            Next.js routes (login, /retailer/*, /desk, /api/auth/*, /api/retailer/*, /api/locale)
                incl. /retailer/capture and /api/retailer/capture, /api/retailer/sku-search
components/     React UI components
lib/            Pure domain logic and server helpers
  money.ts          integer-paise helpers, half-up rounding, INR formatting
  scheme-engine.ts  line pricing: schemes, GST, stock checks
  pricing.ts        order totals and credit-hold decision
  ai-capture.ts     text-order extraction: Gemini provider, offline parser, engine selection
  hinglish.ts       normalization, number/unit words, Levenshtein
  sku-matcher.ts    phrase -> SKU candidates, heuristic confidence, alternatives
  capture/          capture pipeline, confirm schema, DB service (parse, confirm, alias learning)
  orders/           cart schema, server quote, transactional order creation, GST breakup
  cart/             browser cart store and quote hook (client)
  i18n.ts           English/Hindi dictionary
  auth/             session signing, roles/route guard, phone validation
  otp/              OtpProvider interface + MockOtpProvider
prisma/         schema, migrations, deterministic seed (static data in seed-data.ts)
scripts/        gemini-smoke.ts live check
tests/          Vitest unit tests
middleware.ts   role guard for /retailer/* and /desk/*
```

## Money and pricing rules

- All money is stored and computed as **integer paise**. Rupees appear only at display
  time, formatted to 2 decimals (`formatINR`). Rupee strings are parsed without floats,
  rounding a third decimal half-up.
- Line pricing (`priceLine`): gross = qty x dealer price per case; slab discount and GST are
  each rounded **half-up to whole paise at line level**; order totals are sums of line values,
  so an order's grand total always equals the sum of its lines.
- Buy-X-get-Y-free repeats per multiple of X (buy 10 get 1: 9 → 0 free, 10 → 1, 19 → 1, 20 → 2).
- Out-of-stock or insufficient stock (including free cases, A4) makes a line `orderable: false`
  with a reason; it is never silently fulfilled.

GST rates in the seed (5% tea/rusk, 12% namkeen/noodles, 18% biscuits, home and personal care)
are **illustrative demo assumptions, not tax advice** (A13). The UI labels every GST rate and
amount as a demo rate and totals carry a footnote; confirm real rates before billing use.

## Seed data

4 fictional brands (Narmada Foods, Shubh Home Care, Satpura Beverages, Rewa Personal Care),
24 SKUs including the three brief samples verbatim (`SKU-BS-075`, `SKU-DT-1KG`, `SKU-TE-250`),
6 active schemes + 1 expired, 10 retailers, 3 salesmen, 2 desk users, 17 phrase aliases
(e.g. "peti biscuit" → `SKU-BS-075`) and 40 past orders over the last 30 days, some captured
from AI text and some on credit hold.

## Deployment notes

Next's built-in response compression is turned off (`next.config.ts`): its gzip of streamed RSC
responses made Chromium abort some client-side navigations. Put the app behind a reverse proxy or
CDN that compresses (gzip or brotli). That matters for retailers on slow 3G. Full configuration,
the optional Gemini key and production steps are in [deployment.md](./deployment.md).

## Roadmap

1. Foundation: schema, seed, scheme engine, pricing, auth
2. Retailer catalogue, cart, checkout, order history (done)
3. AI text order capture with confidence, alternatives, human confirmation and alias learning (done)
4. Order desk dashboard, corrections, credit holds, Tally CSV export
5. UI polish, Hindi/English labels, loading/empty/error states, deployment guide
