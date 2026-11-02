# Kirana OrderDesk

Retailer ordering web app for an FMCG distributor in Jabalpur serving ~1,800 kirana
shops through 18 salesmen. Retailers see the catalogue with live stock, their dealer
price and the current scheme, and order in a minute; the order desk reviews orders,
manages credit holds and exports to Tally (mocked). AI-assisted capture of WhatsApp
text orders comes in a later chunk.

Business assumptions are recorded in [ASSUMPTIONS.md](./ASSUMPTIONS.md).

## Stack

- Next.js 15 (App Router) + TypeScript (strict) + Tailwind CSS
- Prisma 6 + SQLite (`prisma/dev.db`) — no external services needed
- Vitest for unit tests, zod for input validation
- External systems are mocked behind interfaces (`lib/otp/otp-provider.ts`; WhatsApp and Tally later)

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

## Project structure

```
app/            Next.js routes (login, /retailer/*, /desk, /api/auth/*, /api/retailer/*, /api/locale)
components/     React UI components
lib/            Pure domain logic and server helpers
  money.ts          integer-paise helpers, half-up rounding, INR formatting
  scheme-engine.ts  line pricing: schemes, GST, stock checks
  pricing.ts        order totals and credit-hold decision
  orders/           cart schema, server quote, transactional order creation, GST breakup
  cart/             browser cart store and quote hook (client)
  i18n.ts           English/Hindi dictionary
  auth/             session signing, roles/route guard, phone validation
  otp/              OtpProvider interface + MockOtpProvider
prisma/         schema, migrations, deterministic seed
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
are illustrative per-category values stored per SKU; confirm them against current GST
notifications before real use.

## Seed data

4 fictional brands (Narmada Foods, Shubh Home Care, Satpura Beverages, Rewa Personal Care),
24 SKUs including the three brief samples verbatim (`SKU-BS-075`, `SKU-DT-1KG`, `SKU-TE-250`),
6 active schemes + 1 expired, 10 retailers, 3 salesmen, 2 desk users, 17 phrase aliases
(e.g. "peti biscuit" → `SKU-BS-075`) and 40 past orders over the last 30 days, some captured
from AI text and some on credit hold.

## Deployment notes

Next's built-in response compression is turned off (`next.config.ts`): its gzip of streamed RSC
responses made Chromium abort some client-side navigations. Put the app behind a reverse proxy or
CDN that compresses (gzip or brotli). That matters for retailers on slow 3G.

## Roadmap

1. Foundation: schema, seed, scheme engine, pricing, auth
2. Retailer catalogue, cart, checkout, order history (done)
3. AI text order capture with confidence, alternatives, human confirmation and alias learning
4. Order desk dashboard, corrections, credit holds, Tally CSV export
5. UI polish, Hindi/English labels, loading/empty/error states, deployment guide
