# Assumptions

These are deliberate, labeled business decisions made where the client brief is
silent or ambiguous. They are not facts; change them only as an explicit decision
and update the code, tests and this file together.

| ID | Assumption | Where it is enforced |
|----|------------|----------------------|
| **A1** | Dealer prices are **per case** (the brief lists case sizes next to prices but does not say so explicitly). The UI must always say "per case of N". | `SKU.dealerPricePerCasePaise`, `lib/scheme-engine.ts` |
| **A2** | Prices **exclude GST**. GST is added at checkout using each SKU's `gstRatePercent` (5%, 12% or 18% per category). Every price display must be labeled "excl. GST". | `SKU.gstRatePercent`, `priceLine()` adds GST per line |
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
