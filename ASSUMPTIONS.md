# Assumptions

These are deliberate, labeled business decisions made where the client brief is
silent or ambiguous. They are not facts; change them only as an explicit decision
and update the code, tests and this file together.

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A1** | Dealer prices are **per case** (the brief lists case sizes next to prices but does not say so explicitly). The UI must always say "per case of N". | `SKU.dealerPricePerCasePaise`, `lib/scheme-engine.ts` |
| **A2** | Prices **exclude GST**. GST is added at checkout using each SKU's `gstRatePercent` (5%, 12% or 18% per category; these rates are demo values, see **A13**). Every price display must be labeled "excl. GST". | `SKU.gstRatePercent`, `priceLine()` adds GST per line |
| **A3** | At most **one active scheme per SKU**. Schemes never stack. | Seed refuses two active schemes per SKU; engine accepts a single scheme |
| **A4** | Free-goods schemes (buy X cases get Y free) **consume stock**: shipped cases = ordered + free. | `priceLine()` checks `ordered + free <= stock` |
| **A5** | A slab discount applies to the **entire line** once the threshold is met. | `priceLine()` applies percent off to `qty x price` |
| **A6** | A **single dealer price list** serves all retailers. Per-retailer pricing is future depth; an unused `RetailerPriceOverride` model stub exists. | `prisma/schema.prisma` |
| **A7** | **OTP login is mocked**: the demo OTP is fixed (`123456`) and shown on the login screen. No real SMS. | `lib/otp/otp-provider.ts` (`MockOtpProvider`) |
| **A8** | **Tally export is mocked** as a downloadable CSV with Tally-style columns. | `TallyExport` model (export built in chunk 4) |
| **A9** | If an order total exceeds the retailer's available credit, the order goes **ON_HOLD** for the desk; it is never silently rejected or silently accepted. | `lib/pricing.ts` (`decideCredit`, `initialOrderStatus`) |

## Added in chunk 2 (retailer ordering)

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A10** | **Credit is reserved when an order is placed** within the limit (`creditUsedPaise` += grand total). An ON_HOLD order does **not** consume credit until the desk approves it. | `lib/orders/create-order.ts` |
| **A11** | **Stock is reserved when any order is placed**, including ON_HOLD orders (shipped cases incl. free goods, A4), so held goods are not sold twice. Restoring stock on desk rejection is part of the desk workflow (chunk 4). | `lib/orders/create-order.ts` |
| **A12** | If stock is insufficient at placement, the order is **rejected with the confirmable quantity per line**; it is **short-confirmed only when the retailer explicitly accepts** the reduced quantities. Lines are never cut silently. | `shortagePolicy` in `lib/orders/cart-schema.ts` |

## Added in chunk 3 (AI order capture from text)

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
