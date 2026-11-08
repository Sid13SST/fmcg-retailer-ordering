# Kirana OrderDesk

Retailer ordering web app for an FMCG distributor in Jabalpur serving ~1,800 kirana
shops through 18 salesmen. Retailers see the catalogue with live stock, their dealer
price and the current scheme, and order in a minute, in English or Hindi. They can also
paste a WhatsApp-style Hinglish message, which AI (or an offline parser) turns into lines
they check and confirm. The order desk reviews orders, corrects AI-mapped lines (teaching
the retailer's aliases), manages credit holds and exports to Tally (mocked CSV).

- **Run it:** [deployment.md](./deployment.md) has exact step-by-step instructions, the
  env variable names, demo logins and how to run the tests.
- **Business assumptions:** [ASSUMPTIONS.md](./ASSUMPTIONS.md) (A1-A34), summarised below.

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

Set `DATABASE_URL` (e.g. `file:./dev.db`) and `SESSION_SECRET` (32+ random characters) in
`.env`; `GEMINI_API_KEY` is optional. Then:

```bash
npx prisma migrate dev
```

```bash
npm run dev
```

Open http://localhost:3000 and log in with `9827000001` (retailer) or `9000000001` (desk),
OTP `123456`.

| Command | What it does |
|---------|--------------|
| `npm test` | Unit + integration tests (Vitest; integration tests use a throwaway `prisma/test.db`, never `dev.db`) |
| `npm run build` | Generate the Prisma client and build for production |
| `npm run seed` | Re-seed demo data (deterministic, idempotent) |
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

## Screenshots

Viewport shots of the seeded demo (catalogue + cart bar, AI capture result, desk review, credit-hold dialog, 360px catalogue, desk dashboard) are in [`docs/screenshots/`](docs/screenshots/).
Hindi UI shots (`hi-*.png`, desktop 1280px and phone 360px) cover the catalogue, cart, checkout, AI capture result and order detail.

## Architecture

```
  Retailer phone (EN/HI)                       Order desk (desktop or phone)
  /retailer/* pages                            /desk/* pages
        |                                             |
        |  HTML from Server Components; small client  |
        |  islands (cart, steppers, capture review)    |
        v                                             v
  +------------------------------------------------------------------+
  | middleware.ts   page role guard  +  cross-site write refusal      |
  +------------------------------------------------------------------+
  | Next.js App Router (Node runtime)                                 |
  |  Server Components read via Prisma           Route handlers       |
  |  (catalogue, orders, desk queue)             /api/retailer/*      |
  |                                              /api/desk/*  /api/auth|
  |        every handler: session -> role guard -> zod -> lib/*       |
  +------------------------------------------------------------------+
  | lib/ (pure, unit-tested domain logic)                             |
  |  money.ts  scheme-engine.ts  pricing.ts   orders/ (quote, create) |
  |  ai-capture.ts -> sku-matcher.ts -> capture/service.ts            |
  |  desk/ (transitions, actions, tally.ts)   auth/  i18n.ts          |
  +-------------------+----------------------+-----------------------+
                      |                      |
              Prisma + SQLite         Mocked externals
              (prisma/dev.db)         OtpProvider (fixed OTP)
                                      Tally CSV download
                                      Gemini (optional, real HTTPS)
```

- **One transaction per business action.** Placing an order, confirming a text order and
  every desk action re-read stock, schemes and credit inside a Prisma transaction with
  conditional updates, so two people cannot oversell stock or act on the same order twice.
- **The browser never prices anything.** The cart holds SKU ids and quantities only; every
  total on screen comes from the server quote (`/api/retailer/quote`), the same code that
  places the order.
- **Domain logic is plain TypeScript in `lib/`**, independent of Next.js, which is what the
  unit tests exercise; route handlers are thin.

## Data model

| Model | Holds |
|-------|-------|
| `Retailer` | shop, owner, phone, area, salesman, credit limit and credit used (paise) |
| `SKU` | code, name, brand, category, case size, dealer price per case (paise, excl. GST), GST rate, stock in cases |
| `Scheme` | one active scheme per SKU: buy X get Y free, or slab % off from X cases |
| `Order` / `OrderLine` | status, source (`CATALOGUE` / `AI_TEXT`), totals in paise; each line snapshots name, price, scheme result, GST and the retailer's original words for AI lines |
| `OrderStatusEvent` | every status change with actor role, desk user name and note (the audit trail) |
| `OrderLineCorrection` | desk corrections: from/to SKU and quantity, alias phrase learned, reason |
| `AICapture` | raw pasted text, full parsed JSON, engine and model, outcome or failure reason |
| `Alias` | phrase -> SKU, distributor-wide or per retailer; source `SEED` / `CONFIRMED` / `CORRECTED` |
| `TallyExport` | the CSV produced for each export (mocked Tally), with a batch id for bulk exports |
| `Salesman`, `DeskUser` | staff; `RetailerPriceOverride` is an unused stub for per-retailer pricing (A6) |

Every money column is an integer number of paise.

## Features

### Retailer

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

### Text order capture

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
Full live verification (model list, one tiny prompt, three free-text orders through the real
capture service, at most 8 calls on a flash-lite model): `npm run verify:ai` with `GEMINI_API_KEY`
in the environment or `.env`; `npm run verify:ai -- --offline` runs the same orders with no
network. Steps and exit codes: [deployment.md](deployment.md#live-verification-script-scriptsverify-live-aits).

### Order desk

Log in as the desk (`9000000001`, OTP `123456`):

- **Dashboard** (`/desk`): incoming orders newest first with retailer, source badge
  (*Catalogue* / *AI capture*), total incl. GST and credit status (*Within limit* / *Over by ₹X*);
  filter by status; tiles for pending review, on credit hold, approved-not-exported and exported
  today (IST, A24). Side panel: retailers with **no order in 14 days** (seed: Khan Daily Needs,
  Chourasia Kirana Store).
- **Review** (`/desk/orders/[id]`): full order with the retailer's credit. AI-captured orders
  show the original message and, per line, the words the retailer wrote next to the mapped SKU.
  The desk can **approve**, **put on hold** (reason), **reject** (reason, shown to the retailer;
  stock returned) or **correct a line** (swap SKU via search and/or change cases). A correction
  reprices the line at today's catalogue (A21), re-checks credit (A25) and, on AI lines,
  **upserts the retailer's alias** for those words (A26). Status changes and corrections appear
  in one audit trail with the desk user's name.
- **Credit holds**: on-hold orders show the live shortfall; approving one opens a confirm dialog
  ("Retailer will exceed credit limit by ₹X"). The server refuses approval unless the client
  sends that exact current shortfall (A22).
- **Tally export (mocked, A8/A28)**: *Export to Tally* on an approved order downloads a CSV
  (Voucher Type, Voucher No, Date, Debtor/Retailer, Item, Qty, Rate, Discount, Amount, GST,
  Ledger), stores it in `TallyExport` and marks the order EXPORTED. *Export today's approved*
  on the dashboard downloads one CSV for every order approved today (A27).
- **Transitions are enforced server-side** (`lib/desk/transitions.ts`, A23): only pending or
  on-hold orders can be approved, only approved orders exported; rejected and exported orders
  are final. A conditional update means two desk users cannot act on the same order at once.

Demo path: order **KOD-00043** (Shri Ram Kirana, AI capture) maps "6 peti biscuit bada" to the
75 g glucose biscuit. Correct it to Marie biscuit 150 g (`SKU-BS-150`), approve, export; the
retailer (`9827000004`) then sees *Sent to billing* and the desk's change on the order.

#### APIs and access control

| Route | Who |
|-------|-----|
| `POST /api/desk/orders/[id]/{approve,hold,reject,export}`, `PATCH /api/desk/orders/[id]/lines/[lineId]`, `POST /api/desk/exports/today`, `GET /api/desk/sku-search` | ORDER_DESK only (retailer → 403, anonymous → 401) |
| `GET /api/orders/[id]`, `GET /api/retailers/[id]/{orders,credit,prices}` | that retailer or the desk; another retailer → 403 (A29) |

`tests/access-control.test.ts` runs the real route handlers and middleware against the test
database: a retailer gets 403 for another retailer's orders, prices and credit and for every desk
API, is redirected away from `/desk`, and anonymous page requests are redirected to `/login`.

## How AI capture works, and where it can go wrong

**Two stages, kept separate.** Extraction turns the message into `{raw_phrase, qty,
unit_hint, sku_guess}` rows (Gemini with strict JSON validated by zod, or the offline
parser). Matching then maps each phrase to SKUs in our own code (`lib/sku-matcher.ts`). The
model never decides the final SKU or price; its `sku_guess` is one input to the score.

**Confidence is a heuristic score, not a probability (A14).** Each candidate SKU gets an
additive score:

| Evidence | Score |
|----------|-------|
| this retailer's own alias, exact / fuzzy | 1.00 / 0.90 |
| distributor alias, exact / fuzzy | 0.92 / 0.80 |
| fuzzy name match (Levenshtein on normalized tokens) | up to 0.90 |
| pack size in the words agrees / conflicts ("250 wala", "1 kilo") | +0.12 / -0.25 |
| Gemini's `sku_guess` points at it | +0.20 |
| retailer ordered it in the last 90 days | up to +0.08 |

`high` needs a score of 0.85 or more **and** a lead of 0.2 over the runner-up; `medium` needs
0.65; below 0.5 the line is shown as *could not match*. The thresholds are hand-tuned on the
seed catalogue and are not calibrated against real outcomes, so the UI says "check this" and
always shows the retailer's own words, two alternatives and a search.

**Where it can go wrong:**

- **Ambiguous words.** "biscuit" fits three SKUs. The margin rule keeps it at `medium`, but
  the top pick can still be the wrong one; the retailer has to look.
- **Learned aliases can be wrong.** If a retailer accepts a wrong match, that phrase becomes
  their alias and outranks everything next time. A desk correction overwrites it (A26), and
  an explicit pack size in the words still beats a contradicting alias (A16).
- **Units.** "5 dabba" could be 5 pieces or 5 cases. We never guess: the retailer must
  choose, and pieces are rounded **up** to whole cases (A15), which can over-order.
- **Numbers.** Gemini can rewrite a quantity; lines where the AI's number differs from the
  number in the words are flagged. Number words outside the built-in list (A20) are missed by
  the offline parser and show as "no quantity".
- **Spelling far from the catalogue.** Heavy misspellings or local brand nicknames fall
  below 0.5 and need a manual search, until the retailer's confirmation teaches the alias.
- **Gemini availability.** Quota or model errors fall back to the next model; if all fail,
  nothing is guessed and the retailer can choose the offline parser explicitly (A19).

Nothing is ordered until every line has an answer and the retailer confirms; the server
re-checks that rule.

## UI and performance choices

- **One design system** (`tailwind.config.ts`, `app/globals.css`): a single primary colour
  (brand orange) for primary actions, slate for everything else, semantic colours only for
  meaning (green = saving/success, amber = needs attention, red = error, sky = info). Shared
  `.btn`, `.field`, `.card` and `.price` classes, a visible focus ring, system fonts.
- **Retailer screens** are built for ordering between customers: every tap target is at
  least 44 px (checked at 360 px with Playwright), prices are the largest text on a card, and
  a **sticky cart bar** above the bottom nav always shows the server-priced total and one
  action (*View cart* / *Checkout*).
- **Desk screens** are denser: aligned numeric columns (`tabular-nums`, right-aligned) in a
  table on wide screens, one card per order on phones so nothing scrolls sideways.
- **Every screen works at 360 px width with no horizontal scroll** (catalogue, cart,
  checkout, text order and its review, orders, order detail, login, desk queue and review,
  in English and Hindi).
- **States:** skeletons while loading (catalogue, cart, orders, desk), empty states (cart,
  orders, search), errors with a retry (route error boundaries, failed quote, failed capture
  with an explicit offline option, failed SKU search), an offline banner, and a bilingual
  404 and root error page.
- **Lean first load.** Pages are Server Components; client JavaScript is limited to small
  islands (cart store, quantity steppers, the cart bar, capture review, desk actions). No UI
  kit, icon font, chart library, date library or web font: product images are emoji, icons
  are text, dates use `Intl`. Dictionaries stay on the server and only the strings a client
  component needs are passed as props. Production build: about 103 kB of shared framework JS
  (React + Next), plus 0.2 to 7 kB per retailer page (largest: text-order capture at 116 kB
  first load in total).
- Next's built-in response compression is off (it broke some streamed navigations in
  Chromium); put a compressing reverse proxy or CDN in front (see deployment.md).

## Hindi

Every retailer-facing string is in the English/Hindi dictionary (`lib/i18n.ts`), including
login and its errors, the capture engine labels, category names and the notes the system
writes on orders (`lib/orders/system-notes.ts`, A30). Tests check that Hindi has every English
key with the same placeholders, that every seeded category has a Hindi name and that every
system note template translates. Product names, brands and SKU codes are not translated (A32).
Text typed by the desk is shown as written. Desk screens are English (A31).

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
6 active schemes + 1 expired, 10 retailers, 3 salesmen, 2 desk users, 22 phrase aliases
(e.g. "peti biscuit" → `SKU-BS-075`) and 43 orders over the last 30 days: some captured from AI
text (with the retailer's words on each line), some on credit hold, approved orders older than
5 days already exported to Tally (with stored CSV), two retailers silent for 14+ days and one
fresh AI order with a deliberately mis-mapped line for the desk demo.

## Security notes

What is in place, and what is not:

- **Input validation:** every route handler validates its body, query and path ids with zod
  before touching the database (`lib/validation.ts`, `lib/*/schemas.ts`); malformed ids answer
  400/404 without a query. Quantities, message length and reasons have upper bounds.
- **Database access** goes only through Prisma's query builder, which parameterizes every
  value. There is no raw SQL.
- **Sessions:** a signed token (HMAC-SHA256 with `SESSION_SECRET`, Web Crypto) in an
  **httpOnly, SameSite=Lax** cookie, `Secure` in production, 7-day expiry; payloads are
  schema-checked on every read. Requests fail closed if the secret is missing or shorter than
  32 characters.
- **Authorization:** `middleware.ts` guards `/retailer/*` and `/desk/*` pages by role; layouts
  check again; every API handler calls `requireRoleApi` or `requireRetailerAccessApi`. A
  retailer can read only its own orders, prices and credit (403 otherwise, even for unknown
  ids, A29). Integration tests run the real handlers and middleware to prove it.
- **CSRF:** SameSite=Lax plus a middleware check that refuses API writes whose `Origin` is
  another site (A34).
- **Headers:** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: same-origin`, a restrictive `Permissions-Policy`, no `X-Powered-By`.
- **Secrets:** none in the repo. `.env` is gitignored; `.env.example` lists names only. The
  Gemini key is read on the server, sent only as a request header and never logged, stored or
  returned to the browser. Gemini receives the pasted message and SKU names only (A17).
- **Output:** React escapes all rendered text; the Tally CSV neutralizes cells that look like
  spreadsheet formulas (A28).

Honest gaps, all acceptable for a demo but required before production:

- **OTP is mocked** (fixed code) and there is **no rate limiting** on login or the AI
  endpoint. A real deployment needs OTP expiry, attempt limits and per-IP/per-number throttling.
- **No Content-Security-Policy** yet (Next's inline scripts need a nonce-based setup).
- **Sessions cannot be revoked** before they expire (stateless tokens); logout only clears the
  cookie on that device.
- **SQLite** is a single file with no encryption at rest; production should use Postgres with
  backups and least-privilege credentials.
- Pasted messages are stored in `AICapture.rawText` and may contain personal data typed by
  the retailer; there is no retention policy yet.

## Assumptions summary

The full table with where each rule is enforced is in [ASSUMPTIONS.md](./ASSUMPTIONS.md).
In short:

- **Pricing:** dealer prices are per case and exclude GST (A1, A2); one active scheme per SKU,
  never stacked (A3); free goods consume stock (A4); a slab discount applies to the whole line
  (A5); one price list for all retailers (A6); GST rates are demo values, labeled everywhere (A13).
- **Credit and stock:** over-limit orders go ON_HOLD, never silently rejected (A9); credit is
  reserved on placement (A10); stock is reserved for every placed order (A11); shortages are
  short-confirmed only with the retailer's explicit consent (A12).
- **AI capture:** confidence is a heuristic (A14); orders are whole cases and unclear units
  are asked (A15); confirmations and desk corrections teach aliases (A16, A26); what Gemini
  sees (A17); model fallback (A18); failures are never replaced by guesses (A19).
- **Desk:** corrections reprice at today's catalogue (A21); over-limit approval needs an
  explicit current-shortfall confirmation (A22); allowed transitions (A23); IST business days
  (A24); Tally CSV layout (A27, A28); access control (A29).
- **Mocks:** OTP (A7) and Tally (A8) are mocked; WhatsApp is a paste box.
- **Chunk 5:** translated system notes (A30), English desk (A31), category dictionary (A32),
  server-priced sticky total (A33), cross-site write refusal (A34).

## Known limits

- **Scale:** SQLite and single-process Next.js are fine for a demo and a few users; 1,800
  retailers ordering at the morning peak need Postgres and more than one instance.
- **Catalogue search** uses `contains` queries: fine for 24 SKUs, not for thousands (needs
  full-text search, and transliteration for Devanagari vs Latin spellings).
- **Offline:** retailers' carts persist on the phone when the connection drops, but nothing
  else works offline; there is no service worker.
- **The AI confidence thresholds** are tuned on the seed catalogue only (A14).
- **No notifications:** the retailer sees desk decisions only by opening *My orders*.
- **No pagination:** *My orders* shows the latest 100 orders and the desk queue loads every order matching the filter; both need paging at real volume.
- **Desk audit trail** is append-only in the database but not tamper-evident.

## Deliberately cut, and what would come next

| Cut | Why | Next step |
|-----|-----|-----------|
| **Salesman offline mode** | 18 salesmen visiting shops with patchy coverage need an installable app with an offline queue and conflict handling, which is a project of its own. The `Salesman` model exists; the role does not. | Add `SALESMAN` role and a PWA with a service worker and a queue of orders keyed by `clientRequestId` (already idempotent), synced when online. |
| **Voice and photo capture** | Text proved the pipeline (extract -> match -> human review -> learn) first; voice and handwritten lists add speech-to-text and OCR error on top of the matching error. | Feed a transcript or an OCR result into the same `parseCapture` pipeline with its own engine label; the review screen does not change. |
| **Per-retailer pricing** | The brief has one dealer price list (A6). | Fill `RetailerPriceOverride` (stub exists, and `/api/retailers/[id]/prices` already applies it), use it in `quoteCart` / `createRetailerOrder`, and add a desk screen to manage it. |
| **Real SMS / WhatsApp / Tally** | External accounts and credentials are out of scope for a take-home. | Swap `MockOtpProvider`, add a WhatsApp Business webhook into the capture pipeline, post Tally XML instead of downloading CSV. |

## Project structure

```
app/            Next.js routes (login, /retailer/*, /desk, /api/auth/*, /api/retailer/*, /api/locale)
                incl. /retailer/capture and /api/retailer/capture, /api/retailer/sku-search,
                /desk/orders/[id], /api/desk/*, /api/orders/[id], /api/retailers/[id]/*
components/     React UI components (retailer/, desk/, shared offline banner)
lib/            Pure domain logic and server helpers
  money.ts          integer-paise helpers, half-up rounding, INR formatting
  scheme-engine.ts  line pricing: schemes, GST, stock checks
  pricing.ts        order totals and credit-hold decision
  ai-capture.ts     text-order extraction: Gemini provider, offline parser, engine selection
  hinglish.ts       normalization, number/unit words, Levenshtein
  sku-matcher.ts    phrase -> SKU candidates, heuristic confidence, alternatives
  capture/          capture pipeline, confirm schema, DB service (parse, confirm, alias learning)
  desk/             desk transitions, actions (approve/hold/reject/correct/export), queries,
                    mocked Tally CSV, IST day helpers
  orders/           cart schema, server quote, transactional order creation, GST breakup,
                    system-note templates and their translation
  cart/             browser cart store and quote hook (client)
  i18n.ts           English/Hindi dictionary, category names
  validation.ts     zod schemas for route ids and search terms
  auth/             session signing, roles/route guard, retailer data access rule, phone validation,
                    cross-site write check
  otp/              OtpProvider interface + MockOtpProvider
prisma/         schema, migrations, deterministic seed (static data in seed-data.ts)
scripts/        gemini-smoke.ts live check; verify-live-ai.ts full live/offline verification
tests/          Vitest unit + integration tests (desk actions, access control, i18n, notes)
middleware.ts   role guard for /retailer/* and /desk/*, cross-site refusal for /api/*
```
