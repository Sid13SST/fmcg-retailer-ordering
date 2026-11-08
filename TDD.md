GitHub URL: https://github.com/Sid13SST/fmcg-retailer-ordering

# Kirana OrderDesk: Technical Design Document

**Chosen brief:** FMCG retailer ordering with AI order capture. Kirana OrderDesk is a retailer
ordering web app for an FMCG distributor in Jabalpur (about 1,800 kirana shops, 18 salesmen).
Retailers browse the catalogue with live stock, dealer price and the current scheme, and
order in English or Hindi. They can also paste a WhatsApp-style Hinglish message, which is
turned into order lines they check and confirm. The order desk reviews orders, corrects
AI-mapped lines, manages credit holds and exports approved orders to Tally (mocked CSV).

Branch: `claude/kirana-orderdesk-foundation-dhe2g8`. How to run it: `deployment.md`.

## 1. Architecture

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router, Node runtime), React 19, TypeScript (strict) |
| Styling | Tailwind CSS; mobile-first layouts, checked at 360px with no horizontal scroll |
| Data | Prisma 6 with SQLite (`prisma/dev.db`), migrations in `prisma/migrations` |
| Validation | zod on every route handler (body, query and path ids) |
| Tests | Vitest: unit tests for the pure domain logic and integration tests against a throwaway SQLite file (`prisma/test.db`); 15 files, 170 tests on the final run |
| AI | Google Gemini over HTTPS (optional), with a deterministic offline parser |

```
 Retailer phone (EN/HI)  /retailer/*             Order desk  /desk/*
            |                                          |
            v                                          v
 middleware.ts: page role guard + refusal of cross-site API writes
 Next.js App Router
   Server Components read through Prisma (catalogue, orders, desk queue)
   Route handlers /api/retailer/*, /api/desk/*, /api/auth/*
     each one: session -> role guard -> zod -> lib/*
 lib/ (plain TypeScript, unit-tested, no Next.js imports)
   money.ts, scheme-engine.ts, pricing.ts, orders/ (quote, create)
   ai-capture.ts -> sku-matcher.ts -> capture/service.ts
   desk/ (transitions, actions, tally.ts), auth/, i18n.ts
 Prisma + SQLite        Mocked: OTP provider, Tally CSV     Optional: Gemini API
```

Design rules:

- **One transaction per business action.** Placing an order, confirming a text order and
  every desk action re-read stock, schemes and credit inside one Prisma transaction with
  conditional updates, so two people cannot oversell stock or act on the same order twice.
- **The browser never prices anything.** The cart stores SKU ids and quantities only. Every
  total on screen comes from the server quote (`/api/retailer/quote`), which runs the same
  code that places the order.
- **All money is integer paise** (INR). Discounts and GST are rounded half-up to whole paise
  at line level (`lib/money.ts`, `lib/scheme-engine.ts`).

Main data: `Retailer` (credit limit and credit used in paise), `SKU` (price per case in paise,
excl. GST; GST rate; stock in cases), `Scheme` (one active per SKU), `Order` / `OrderLine`
(lines snapshot name, price, scheme result, GST and, for AI lines, the retailer's words),
`OrderStatusEvent` (audit trail), `OrderLineCorrection`, `AICapture` (raw text, parsed JSON,
engine, model, outcome), `Alias` (phrase -> SKU, distributor-wide or per retailer),
`TallyExport`.

## 2. Deterministic pricing and schemes vs AI responsibilities

**Deterministic code decides everything that costs money:**

- Price per case, scheme result, GST, line and order totals: `priceLine()` in
  `lib/scheme-engine.ts` and `computeOrderTotals()` in `lib/pricing.ts`, covered by unit
  tests. Buy-X-get-Y-free adds free cases that also consume stock (A4); a slab discount
  applies to the whole line once its threshold is met (A5); schemes never stack (A3).
- Stock checks and reservation, credit checks and order status: `lib/orders/create-order.ts`
  and `lib/desk/actions.ts`.
- The final SKU for each text line: `lib/sku-matcher.ts` scores candidates from aliases,
  fuzzy name matching, pack size, the retailer's order history and (optionally) the AI's
  guess. Confidence is a hand-tuned heuristic, not a probability (A14).

**The AI only reads text.** Gemini turns a free-text message into rows of
`{raw_phrase, qty, unit_hint, sku_guess}` (strict JSON, validated with zod). It never sees
prices, credit or retailer details (A17), never decides the final SKU (its guess is one input
to the matcher's score), and **never places an order**. Every captured line is shown with the
retailer's own words, a confidence badge, two alternatives and a search. Nothing is ordered
until the retailer answers every line and presses confirm, and the server checks that rule
again (A15, A19). Each confirmation or desk correction teaches that retailer's alias for the
words (A16, A26).

## 3. Credit-hold logic

- **At placement:** `decideCredit()` compares the order's grand total with available credit
  (limit minus used). If the total fits, the order is PENDING_DESK_REVIEW and its total is
  reserved in `creditUsedPaise` (A10). If not, the order goes ON_HOLD with the shortfall
  recorded. It is never silently rejected or silently accepted (A9), and it reserves no
  credit while held (A10). Stock is reserved in both cases (A11).
- **Desk approval of a held order** recomputes the shortfall from the retailer's live credit.
  If approving would exceed the limit, the desk must confirm the exact current amount
  ("Retailer will exceed credit limit by Rs X"); if credit moved meanwhile, the server refuses
  and returns the new amount (A22). Approval then reserves the full total, even over the limit.
- **Other transitions:** rejecting releases reserved credit and returns stock; a manual hold
  releases reserved credit (A23). A desk line correction re-checks credit and can move a
  pending order to ON_HOLD (A25).
- **Seed data follows the same rule:** seeded pending orders reserve their totals, held ones
  do not, and `tests/seed-credit.test.ts` checks it (A10).

## 4. Login: mocked OTP and its limits

Login is phone number + OTP. The OTP is **mocked** (A7): `MockOtpProvider`
(`lib/otp/otp-provider.ts`) accepts the fixed code `123456` for any registered number, and the
login screen shows it. No SMS is sent. The provider sits behind an `OtpProvider` interface so
a real SMS gateway can replace it.

Limits of the demo login, which must be fixed before production:

- the code is fixed and public, with no expiry and no attempt limits;
- there is no rate limiting on login or on the AI endpoint;
- sessions are stateless signed cookies (HMAC-SHA256, httpOnly, SameSite=Lax, 7 days) and
  cannot be revoked before they expire; logout clears the cookie on that device only.

Access control itself is real: pages and APIs are guarded by role, and a retailer can read
only its own orders, prices and credit (A29). Cross-site API writes are refused (A34).

## 5. AI order capture: live path, offline fallback, what was verified

**Engine selection** (`engineMode()` / `selectProvider()` in `lib/ai-capture.ts`):

- `GEMINI_API_KEY` set: the live Gemini path. The key is read on the server from the
  environment (`.env`, which is gitignored) and is sent only as the `x-goog-api-key` header.
- `GEMINI_VIA_PROXY=1`: Gemini with no key header, for networks whose egress proxy adds it.
- Neither: the **deterministic offline parser**, labeled on screen as "Offline parser - no AI
  key configured".

**When Gemini fails:** HTTP 404, 429 and transient 5xx errors move to the next model (A18).
Invalid JSON gets one repair prompt. If everything fails, the capture is stored as FAILED and
the retailer is told plainly; nothing is guessed. Using the offline parser after that is the
retailer's explicit choice and is labeled "Offline parser - AI not used for this message"
(A19). Both engines feed the same matcher and the same review screen.

**What was verified, stated honestly:**

| Item | Status |
|------|--------|
| Offline parser, end to end in the app | Verified in this final phase: capture screen screenshots in English and Hindi (`docs/screenshots/b-ai-capture-result.png`, `hi-ai-capture-*.png`), and `npm run verify:ai -- --offline` read the English, Hinglish and Devanagari test orders with the right SKUs and quantities, with networking disabled. |
| Gemini path, automated | Covered by unit tests with a mocked `fetch` (`tests/gemini-provider.test.ts`): JSON validation, repair prompt, model fallback, error handling. These tests make no real API calls. |
| Gemini path, live | **Verified live on 2026-11-08** with model `gemini-3.5-flash-lite` on a Google AI Studio project confirmed as Free tier (no billing) before any call. Run outside the development session on a clean checkout of `9fcfce5` (where `npm ci`, migrate, seed, 170/170 tests, typecheck, lint and the production build also passed), with the key supplied through the environment only. `npm run verify:ai` exited 0: the key listed its models, the tiny prompt returned "pong", and all three free-text orders (English, Hinglish, Hindi in Devanagari) went through the app's real `parseCapture` path with engine GEMINI, the correct SKU and quantity on every line, high confidence and alternatives shown. 5 of the 8 budgeted API calls were used. This is a sample, not an exhaustive test: live parse quality across the wider catalogue and more varied phrasing has not been measured. Earlier development notes (A18, 2026-11-02) also record live calls in which the primary model answered 503 "high demand". |
| Live verification script | `npm run verify:ai` (`scripts/verify-live-ai.ts`) lists the models available to the key, sends one tiny prompt and runs three free-text orders through the real `parseCapture` path, printing the engine and the parsed JSON. It defaults to a flash-lite model (larger free quota), makes at most 8 API calls per run, and exits with code 3 and the exact API message on any quota, billing or permission error. Used for the 2026-11-08 live run above; steps are in `deployment.md`. |

The offline parser remains the documented path when no key is configured or the free quota
is exhausted. For zero cost, the key should come from a Google AI Studio project without
billing enabled.

## 6. Assumptions (A1-A34)

These are the labeled business decisions from `ASSUMPTIONS.md`, with the same numbering.

### Core assumptions

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A1** | Dealer prices are **per case** (the brief lists case sizes next to prices but does not say so explicitly). The UI must always say "per case of N". | `SKU.dealerPricePerCasePaise`, `lib/scheme-engine.ts` |
| **A2** | Prices **exclude GST**. GST is added at checkout using each SKU's `gstRatePercent` (5%, 12% or 18% per category; these rates are demo values, see **A13**). Every price display must be labeled "excl. GST". | `SKU.gstRatePercent`, `priceLine()` adds GST per line |
| **A3** | At most **one active scheme per SKU**. Schemes never stack. | Seed refuses two active schemes per SKU; engine accepts a single scheme |
| **A4** | Free-goods schemes (buy X cases get Y free) **consume stock**: shipped cases = ordered + free. | `priceLine()` checks `ordered + free <= stock` |
| **A5** | A slab discount applies to the **entire line** once the threshold is met. | `priceLine()` applies percent off to `qty x price` |
| **A6** | A **single dealer price list** serves all retailers. Per-retailer pricing is future depth; an unused `RetailerPriceOverride` model stub exists. | `prisma/schema.prisma` |
| **A7** | **OTP login is mocked**: the demo OTP is fixed (`123456`) and shown on the login screen. No real SMS. | `lib/otp/otp-provider.ts` (`MockOtpProvider`) |
| **A8** | **Tally export is mocked** as a downloadable CSV with Tally-style columns. | `lib/desk/tally.ts`, `TallyExport` (layout: A28) |
| **A9** | If an order total exceeds the retailer's available credit, the order goes **ON_HOLD** for the desk; it is never silently rejected or silently accepted. | `lib/pricing.ts` (`decideCredit`, `initialOrderStatus`) |

### Added in chunk 2 (retailer ordering)

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A10** | **Credit is reserved when an order is placed** within the limit (`creditUsedPaise` += grand total). An ON_HOLD order does **not** consume credit until the desk approves it. | `lib/orders/create-order.ts`; the seed replays the same rule (`prisma/seed.ts`, checked by `tests/seed-credit.test.ts`) |
| **A11** | **Stock is reserved when any order is placed**, including ON_HOLD orders (shipped cases incl. free goods, A4), so held goods are not sold twice. Desk rejection restores it (A23). | `lib/orders/create-order.ts` |
| **A12** | If stock is insufficient at placement, the order is **rejected with the confirmable quantity per line**; it is **short-confirmed only when the retailer explicitly accepts** the reduced quantities. Lines are never cut silently. | `shortagePolicy` in `lib/orders/cart-schema.ts` |

### Added in chunk 3 (AI order capture from text)

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A13** | **GST rates are illustrative demo assumptions, not tax advice.** The seeded 5% (tea, rusk), 12% (namkeen, noodles) and 18% (biscuits, home and personal care) category rates are not taken from the brief or from GST notifications. Every UI surface that shows a GST rate or amount labels it as a demo rate ("GST 18% (demo rate)", "GST (demo rates)") and totals carry a footnote saying so. Confirm real rates before any billing use. | `prisma/seed-data.ts`; `lib/i18n.ts` (`gstAt`, `gst`, `gstBreakup`, `demoGstNote`); `TotalsCard`, order detail |
| **A14** | **Match confidence is a heuristic, not a probability.** `high` / `medium` / `low` are hand-tuned thresholds on an additive score (retailer alias > distributor alias > fuzzy name match, plus pack-size agreement, the AI's `sku_guess` and the retailer's 90-day order history). `high` needs score >= 0.85 *and* a lead of >= 0.2 over the runner-up, so an ambiguous word like "biscuit" is at most `medium`; below 0.5 the line is shown as "could not match". The numbers are not calibrated against real outcomes; the UI tooltip says so. | `lib/sku-matcher.ts` (`MATCH_THRESHOLDS`) |
| **A15** | **Orders are always in whole cases; unclear units are asked.** "peti"/"case"/"carton" mean cases. Piece words ("dabba", "packet", "piece", "nag") or no unit at all make the retailer choose *cases* or *pieces*; pieces are converted to whole cases **rounded up** (e.g. 10 pieces of a 96-piece case = 1 case) and shown before confirmation, where the retailer can change it. A missing quantity is never assumed to be 1. The server rejects a confirmation without the unit answer. | `lib/hinglish.ts`, `CaptureLineCard`, `confirmCapture()` |
| **A16** | **Every confirmed line teaches a retailer alias.** The normalized product words (e.g. "biscuit chhota") are upserted as that retailer's alias for the chosen SKU: `CONFIRMED` when the suggestion was accepted, `CORRECTED` when the retailer picked a different SKU (a changed mapping is overwritten). Retailer aliases outrank distributor aliases next time and show a "learned" hint. An explicit pack size in the words still outranks a learned alias that contradicts it, so substituting 500 g once because 250 g was out of stock does not permanently turn "250 wala" into 500 g. | `learnAlias()` in `lib/capture/service.ts`, `lib/sku-matcher.ts` |
| **A17** | **What Gemini sees:** only the pasted message and the catalogue's SKU codes, names and brands. No retailer name, phone, credit or prices are sent. The message itself may contain whatever the retailer typed; it is sent to Google's API and stored in `AICapture.rawText`. | `lib/ai-capture.ts` (`systemPrompt`) |
| **A18** | **Model fallback.** The brief names `gemini-flash-latest` with `gemini-2.5-flash-lite` as fallback "on 404/429". We also fall back on transient 500/502/503/504 (live calls on 2026-11-02 returned 503 "high demand" for the primary); 401/403 never fall back. On that date `gemini-2.5-flash-lite` answered 404 ("no longer available to new users"), so the **default fallback is `gemini-3.5-flash-lite`**; both names stay overridable with `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL`. | `FALLBACK_STATUSES`, `geminiModels()` |
| **A19** | **An AI failure is never silently replaced by a guess.** Invalid JSON gets one repair prompt; if that also fails (or all models are unavailable) the capture is stored as `FAILED` with the reason and the retailer sees "could not read this message". Using the offline parser after that is the retailer's explicit choice and is labeled "Offline parser - AI not used for this message". | `GeminiProvider.extract()`, `parseCapture()`, `CaptureView` |
| **A20** | **Offline parsing vocabulary** (number words, unit words, filler words, a small Hinglish-to-catalogue glossary such as chai -> tea, sabun -> soap) is a built-in list maintained in code, not learned. Retailer-specific vocabulary is learned through aliases (A16). | `lib/hinglish.ts`, `GLOSSARY` in `lib/sku-matcher.ts` |

### Added in chunk 4 (order desk)

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A21** | **A desk line correction reprices the line at today's catalogue** (current dealer price, active scheme and stock), not at the price snapshotted when the retailer placed the order. The old line's shipped cases go back to stock before the new line is reserved; if stock cannot ship the new line the correction is refused and nothing changes. A SKU already on another line of the order cannot be swapped in (change that line's quantity instead). | `correctOrderLine()` in `lib/desk/actions.ts` |
| **A22** | **Approving over the credit limit needs an explicit confirmation of the current shortfall.** The shortfall is recomputed at approval time from the retailer's live credit, not taken from the value stored when the order was held. The client must send the exact amount it showed ("Retailer will exceed credit limit by Rs X"); if credit moved meanwhile, the server refuses and returns the new amount, so the desk never confirms a stale number. Approval then reserves the full order total, even beyond the limit. | `approveOrder()`, `OrderActions` dialog |
| **A23** | **Allowed desk transitions:** approve from PENDING_DESK_REVIEW or ON_HOLD; hold from PENDING_DESK_REVIEW; reject (reason required, shown to the retailer) from PENDING_DESK_REVIEW, ON_HOLD or CONFIRMED (an approved order can still be stopped before it reaches Tally); line corrections only before approval; export only from CONFIRMED. EXPORTED and REJECTED are final. Rejection returns stock (A11) and releases any reserved credit; a manual hold releases reserved credit (A10). | `lib/desk/transitions.ts` |
| **A24** | **Business days are IST (Asia/Kolkata, UTC+05:30)** for "exported today", "approved today" and the bulk export, whatever the server's time zone. | `lib/desk/ist.ts` |
| **A25** | **Credit is re-checked after a correction.** A pending order whose corrected total no longer fits the available credit moves to ON_HOLD with the shortfall (A9); an on-hold order stays on hold with a refreshed shortfall even if it now fits (the desk approves it, without a dialog when the shortfall is 0). | `correctOrderLine()` |
| **A26** | **Every desk correction of an AI-captured line teaches that retailer's alias** for the words behind the line (the same normalized phrase as A16): a SKU swap upserts phrase -> new SKU as `CORRECTED`; a quantity-only correction confirms the existing mapping. The phrase is recorded on the correction and shown in the audit trail. Catalogue lines have no words and teach nothing. | `correctOrderLine()`, `learnAlias()` |
| **A27** | **"Export today's approved"** means orders still CONFIRMED whose approval happened today (IST). Older approved-but-unexported orders are exported one by one from the review screen; the dashboard counts them separately. | `exportTodaysApproved()` |
| **A28** | **Tally CSV layout (mocked, A8):** voucher type `Sales Order` (Tally raises the invoice), voucher number = order number, date = order date (DD-MM-YYYY, IST), debtor = "shop name, area", one row per line with Qty "N Case", Rate per case, scheme Discount, taxable Amount, GST amount (demo rates, A13) and a sales ledger per GST rate ("Sales @ 18% GST"); free goods are a separate zero-value row on a "Free goods (scheme)" ledger. Each export stores its CSV in `TallyExport`; a bulk export stores one row per order sharing a `batchId`. Cells that look like spreadsheet formulas are prefixed with `'`. | `lib/desk/tally.ts` |
| **A29** | **Access control:** a retailer may read only its own orders, prices and credit; the desk may read all. A retailer asking for another retailer's order gets 403 whether or not the id exists, so ids cannot be probed. "No order in 14 days" counts submitted orders only (not drafts). | `lib/auth/access.ts`, `app/api/orders/[id]`, `lib/desk/queries.ts` |

### Added in chunk 5 (polish, Hindi coverage, security)

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A30** | **System-written notes are stored in English and translated for the retailer at display time.** Notes the app writes itself (credit hold, short-confirm, captured-from-text, approved, exported) come from one set of templates and are shown in the retailer's language. Text a desk user types (hold or rejection reason, correction note) is shown **verbatim, not machine-translated**, because a wrong translation of a business reason is worse than English. | `lib/orders/system-notes.ts`, `/retailer/orders/[id]` |
| **A31** | **Desk screens stay English-only.** The brief's Hindi need is for shopkeepers; desk staff work in English (the Tally ledger and the audit trail are English too). | `app/desk/*`, `components/desk/*` |
| **A32** | **Category names are translated by a fixed dictionary.** A category added later without a Hindi entry falls back to its stored English name rather than being hidden. Product names, brands and SKU codes are never translated (they must match the invoice and the shelf). | `categoryLabel()` in `lib/i18n.ts` |
| **A33** | **The sticky cart total is the server's quote,** the same number checkout uses (schemes applied, GST at demo rates, A13). While a change is being re-priced the old total is greyed out, never estimated in the browser. | `components/retailer/cart-bar.tsx`, `/api/retailer/quote` |
| **A34** | **Cross-site writes are refused, origin-less requests are allowed.** A POST/PATCH/PUT/DELETE to `/api/*` whose `Origin` header names another host gets 403. Requests with no `Origin` (curl, scripts, tests) pass to the route, which still checks the session and role. This is defence in depth on top of the SameSite=Lax session cookie, not a replacement for it. | `lib/auth/origin.ts`, `middleware.ts` |


## 7. Known limits and deliberate cuts

- SQLite and a single Next.js process suit a demo; the morning peak of 1,800 retailers needs
  Postgres and more than one instance.
- Catalogue search uses `contains` queries (fine for 24 SKUs). It needs full-text search and
  Devanagari/Latin transliteration at scale.
- No service worker: only the cart survives a dropped connection. No notifications. No
  pagination on long lists. No Content-Security-Policy yet.
- Match-confidence thresholds are tuned on the seed catalogue only (A14).
- Cut on purpose: salesman offline app, voice and photo capture, per-retailer pricing (a
  model stub exists, A6), and real SMS, WhatsApp and Tally integrations (mocked, A7, A8).
