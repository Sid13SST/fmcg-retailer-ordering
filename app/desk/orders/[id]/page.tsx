import Link from "next/link";
import { notFound } from "next/navigation";
import { DeskStatusBadge, formatIST, SourceBadge } from "@/components/desk/labels";
import { LineCorrector } from "@/components/desk/line-corrector";
import { OrderActions } from "@/components/desk/order-actions";
import { prisma } from "@/lib/db";
import { deskOrderDetail } from "@/lib/desk/queries";
import { availableActions } from "@/lib/desk/transitions";
import { formatINR } from "@/lib/money";
import { availableCreditPaise } from "@/lib/pricing";

export const dynamic = "force-dynamic";

type AuditEntry = { at: Date; who: string; title: string; detail: string | null; tone: string };

export default async function DeskOrderReview({ params }: { params: Promise<{ id: string }> }) {
  const order = await deskOrderDetail(prisma, (await params).id.slice(0, 64));
  if (!order) notFound();

  const actions = availableActions(order.status);
  const canCorrect = actions.includes("CORRECT_LINE");
  const isAi = order.source === "AI_TEXT";
  const capture = order.aiCaptures[0] ?? null;
  const r = order.retailer;

  const audit: AuditEntry[] = [
    ...order.statusEvents.map((e) => ({
      at: e.createdAt,
      who: e.actorRole === "RETAILER" ? "Retailer" : (e.actorName ?? "Order desk"),
      title: e.fromStatus ? `${e.fromStatus.replace(/_/g, " ").toLowerCase()} → ${e.toStatus.replace(/_/g, " ").toLowerCase()}` : `Placed as ${e.toStatus.replace(/_/g, " ").toLowerCase()}`,
      detail: e.note,
      tone: "bg-slate-400",
    })),
    ...order.lineCorrections.map((c) => ({
      at: c.createdAt,
      who: c.actorName,
      title:
        c.fromSkuCode !== c.toSkuCode
          ? `Line corrected: ${c.fromSkuCode} × ${c.fromQtyCases} → ${c.toSkuCode} × ${c.toQtyCases}`
          : `Quantity corrected: ${c.toSkuCode} ${c.fromQtyCases} → ${c.toQtyCases} cases`,
      detail: [c.aliasPhrase ? `Alias learned for this retailer: “${c.aliasPhrase}” → ${c.toSkuCode}` : null, c.reason].filter(Boolean).join(" · ") || null,
      tone: "bg-violet-500",
    })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  return (
    <div className="space-y-5">
      <Link href="/desk" className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700">
        ← All orders
      </Link>

      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{order.orderNumber}</h2>
            <DeskStatusBadge status={order.status} />
            <SourceBadge source={order.source} />
          </div>
          <p className="text-sm text-slate-600">Placed {formatIST(order.createdAt)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
          <p className="font-semibold">{r.shopName}</p>
          <p className="text-xs text-slate-500">{r.name} · {r.area} · {r.phone}</p>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-xs tabular-nums">
            <div><dt className="text-slate-500">Limit</dt><dd className="font-semibold">{formatINR(r.creditLimitPaise)}</dd></div>
            <div><dt className="text-slate-500">Used</dt><dd className="font-semibold">{formatINR(r.creditUsedPaise)}</dd></div>
            <div><dt className="text-slate-500">Available</dt><dd className="font-semibold">{formatINR(availableCreditPaise(r))}</dd></div>
          </dl>
        </div>
      </header>

      {order.status === "ON_HOLD" && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            On credit hold
            {order.currentShortfallPaise > 0 ? ` · shortfall ${formatINR(order.currentShortfallPaise)}` : " · now within the available credit"}
          </p>
          {order.holdReason && <p className="mt-1">{order.holdReason}</p>}
        </div>
      )}
      {order.status === "REJECTED" && order.rejectionReason && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>Rejected:</strong> {order.rejectionReason}</p>
      )}
      {order.notes && <p className="rounded-md bg-slate-100 px-3 py-2 text-sm text-slate-700">{order.notes}</p>}

      {isAi && (
        <section aria-labelledby="raw-title" className="rounded-xl border border-violet-200 bg-violet-50 p-4">
          <h3 id="raw-title" className="text-sm font-semibold text-violet-900">Original message from the retailer</h3>
          {capture ? (
            <>
              <blockquote className="mt-2 whitespace-pre-wrap rounded-md bg-white p-3 font-mono text-sm text-slate-800 ring-1 ring-violet-100">{capture.rawText}</blockquote>
              <p className="mt-1 text-xs text-violet-800">
                Read by {capture.engine === "GEMINI" ? `AI (Gemini${capture.model ? `, ${capture.model}` : ""})` : capture.engine === "OFFLINE" ? "offline parser" : "text capture"} · confirmed by the retailer before placing
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-violet-900">The original message is not available for this order.</p>
          )}
        </section>
      )}

      <section aria-labelledby="lines-title" className="rounded-xl border border-slate-200 bg-white">
        <h3 id="lines-title" className="border-b border-slate-200 p-4 text-base font-semibold">Lines</h3>
        <ul className="divide-y divide-slate-100">
          {order.lines.map((l) => (
            <li key={l.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              {isAi && (
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Retailer wrote</p>
                  <p className="font-mono text-violet-900">{l.sourcePhrase ? `“${l.sourcePhrase}”` : "—"}</p>
                </div>
              )}
              <div className={`min-w-0 ${isAi ? "" : "sm:col-span-2"}`}>
                <p className="text-xs uppercase tracking-wide text-slate-500">{isAi ? "Mapped to" : "Item"}</p>
                <p className="font-medium">
                  {l.skuName} <span className="text-xs text-slate-500">({l.skuCode}, case of {l.caseSize})</span>
                </p>
                <p className="text-xs text-slate-600 tabular-nums">
                  {l.qtyCases} case{l.qtyCases === 1 ? "" : "s"} × {formatINR(l.unitPricePaise)} excl. GST
                  {l.freeCases > 0 && <span className="text-emerald-700"> · +{l.freeCases} free</span>}
                  {l.discountPaise > 0 && <span className="text-emerald-700"> · {l.discountPercent}% off (−{formatINR(l.discountPaise)})</span>}
                  {" · "}GST {l.gstRatePercent}% (demo rate) {formatINR(l.gstPaise)}
                </p>
                {canCorrect && (
                  <LineCorrector
                    orderId={order.id}
                    retailerId={order.retailerId}
                    isAiLine={isAi && !!l.sourceProductText}
                    line={{ id: l.id, skuId: l.skuId, skuCode: l.skuCode, skuName: l.skuName, qtyCases: l.qtyCases }}
                  />
                )}
              </div>
              <p className="font-semibold tabular-nums sm:text-right">{formatINR(l.totalPaise)}</p>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-slate-200 p-4 text-sm tabular-nums">
          {order.discountPaise > 0 && (
            <div className="flex justify-between text-emerald-700"><dt>Scheme discount</dt><dd>−{formatINR(order.discountPaise)}</dd></div>
          )}
          <div className="flex justify-between"><dt className="text-slate-600">Subtotal (excl. GST)</dt><dd>{formatINR(order.subtotalPaise)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">GST (demo rates)</dt><dd>{formatINR(order.gstPaise)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold"><dt>Grand total</dt><dd>{formatINR(order.grandTotalPaise)}</dd></div>
        </dl>
      </section>

      <OrderActions
        orderId={order.id}
        orderNumber={order.orderNumber}
        actions={actions.filter((a) => a !== "CORRECT_LINE")}
        shortfallPaise={order.status === "ON_HOLD" ? order.currentShortfallPaise : 0}
        hasExport={order.tallyExports.length > 0}
      />

      <section aria-labelledby="audit-title" className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 id="audit-title" className="mb-3 text-base font-semibold">Audit trail</h3>
        <ol className="relative ml-2 border-l border-slate-200">
          {audit.map((e, i) => (
            <li key={i} className="mb-3 ml-4 last:mb-0">
              <span aria-hidden className={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full ${e.tone}`} />
              <p className="text-sm font-medium first-letter:uppercase">{e.title}</p>
              <p className="text-xs text-slate-500">{formatIST(e.at)} · {e.who}</p>
              {e.detail && <p className="mt-0.5 text-sm text-slate-700">{e.detail}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
