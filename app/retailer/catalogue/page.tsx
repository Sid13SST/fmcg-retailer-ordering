import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AddToCart } from "@/components/retailer/add-to-cart";
import { CatalogueCartBar } from "@/components/retailer/cart-bar";
import { SchemeBadge, StockBadge, stockLevel } from "@/components/retailer/badges";
import { getSession } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db";
import { fmt, plural } from "@/lib/i18n-format";
import { categoryLabel, schemeBadge } from "@/lib/i18n";
import { getI18n } from "@/lib/i18n-server";
import { formatINR } from "@/lib/money";
import { availableCreditPaise } from "@/lib/pricing";
import { z } from "zod";

export const dynamic = "force-dynamic";

const searchSchema = z.object({
  q: z.string().trim().max(60).optional().catch(undefined),
  cat: z.string().trim().max(40).optional().catch(undefined),
});

export default async function CataloguePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const { q, cat } = searchSchema.parse({
    q: typeof raw.q === "string" ? raw.q : undefined,
    cat: typeof raw.cat === "string" ? raw.cat : undefined,
  });
  const session = (await getSession())!; // layout guarantees a retailer session
  const { m } = await getI18n();

  // Aliases visible to this retailer: distributor-wide plus their own.
  const aliasScope: Prisma.AliasWhereInput = { OR: [{ retailerId: null }, { retailerId: session.sub }] };
  const where: Prisma.SKUWhereInput = { active: true };
  if (cat) where.category = cat;
  if (q) {
    where.OR = [
      { name: { contains: q } },
      { brand: { contains: q } },
      { code: { contains: q } },
      { category: { contains: q } },
      { aliases: { some: { AND: [aliasScope, { phrase: { contains: q } }] } } },
    ];
  }

  const [retailer, categories, skus] = await Promise.all([
    prisma.retailer.findUniqueOrThrow({ where: { id: session.sub } }),
    prisma.sKU.findMany({ where: { active: true }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.sKU.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        schemes: { where: { active: true }, take: 1 },
        aliases: q ? { where: { AND: [aliasScope, { phrase: { contains: q } }] }, take: 1 } : false,
      },
    }),
  ]);
  // In-stock items first; out-of-stock stay visible at the end.
  skus.sort((a, b) => Number(a.stockCases === 0) - Number(b.stockCases === 0));

  const qtyLabels = {
    decrease: m.catalogue.decrease,
    increase: m.catalogue.increase,
    qtyLabel: m.catalogue.qtyLabel,
    add: m.catalogue.add,
    notAvailable: m.catalogue.notAvailable,
    inCart: m.catalogue.inCart,
  };

  return (
    <main>
      <h1 className="sr-only">{m.catalogue.title}</h1>

      <p className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 ring-1 ring-slate-200">
        {m.credit.available}:{" "}
        <strong className="tabular-nums text-slate-900">{formatINR(availableCreditPaise(retailer))}</strong>
        <span className="text-slate-400"> / {formatINR(retailer.creditLimitPaise)}</span>
      </p>

      <form method="get" className="flex flex-col gap-2 sm:flex-row" role="search">
        <label htmlFor="q" className="sr-only">
          {m.catalogue.searchLabel}
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={m.catalogue.searchPlaceholder}
          aria-describedby="q-hint"
          className="field min-w-0 sm:flex-1"
        />
        <div className="flex gap-2">
          <label htmlFor="cat" className="sr-only">
            {m.catalogue.category}
          </label>
          <select
            id="cat"
            name="cat"
            defaultValue={cat ?? ""}
            className="field min-w-0 flex-1 px-2"
          >
            <option value="">{m.catalogue.allCategories}</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {categoryLabel(m, c.category)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-lg btn-dark px-5">
            {m.catalogue.search}
          </button>
        </div>
      </form>
      <p id="q-hint" className="mt-1 text-xs text-slate-500">
        {m.catalogue.searchHint}
      </p>

      <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
        <span>{plural(skus.length, m.catalogue.resultsOne, m.catalogue.resultsMany)}</span>
        {(q || cat) && (
          <Link href="/retailer/catalogue" className="min-h-11 content-center px-2 font-medium text-brand-700 underline">
            {m.catalogue.clearSearch}
          </Link>
        )}
      </div>

      {skus.length === 0 ? (
        <section className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-3xl" aria-hidden>
            🔍
          </p>
          <h2 className="mt-2 text-lg font-semibold">{m.catalogue.noResults}</h2>
          <p className="mt-1 text-sm text-slate-600">{m.catalogue.noResultsHint}</p>
          <Link
            href="/retailer/catalogue"
            className="mt-4 inline-flex min-h-11 items-center rounded-md bg-brand-600 px-5 font-semibold text-white"
          >
            {m.catalogue.clearSearch}
          </Link>
        </section>
      ) : (
        <ul className="mt-2 grid gap-3 sm:grid-cols-2">
          {skus.map((s) => {
            const level = stockLevel(s.stockCases);
            const scheme = s.schemes[0];
            const alias = Array.isArray(s.aliases) ? s.aliases[0] : undefined;
            const stockLabel =
              level === "IN_STOCK"
                ? m.catalogue.inStock
                : level === "LOW_STOCK"
                  ? fmt(m.catalogue.lowStock, { n: s.stockCases })
                  : m.catalogue.outOfStock;
            return (
              <li
                key={s.id}
                className={`flex flex-col gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 ${level === "OUT_OF_STOCK" ? "opacity-75" : ""}`}
              >
                <div className="flex gap-3">
                  <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-2xl">
                    {s.imageEmoji ?? "📦"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-semibold leading-snug">{s.name}</h2>
                    <p className="text-xs text-slate-500">
                      {s.brand} · {s.code}
                    </p>
                    {alias && <p className="text-xs text-brand-700">{fmt(m.catalogue.matchedAlias, { phrase: alias.phrase })}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StockBadge level={level} label={stockLabel} />
                  {scheme && <SchemeBadge label={schemeBadge(m, scheme)} />}
                </div>
                <div className="mt-auto flex items-end justify-between gap-2">
                  <div>
                    <p className="price">{formatINR(s.dealerPricePerCasePaise)}</p>
                    <p className="text-xs text-slate-600">
                      {fmt(m.common.perCaseOf, { n: s.caseSize })} · {m.common.exclGst}
                    </p>
                  </div>
                  <AddToCart skuId={s.id} orderable={s.stockCases > 0} maxCases={s.stockCases} labels={qtyLabels} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CatalogueCartBar
        cta={m.cart.viewCart}
        labels={{ itemsOne: m.orders.itemsOne, itemsMany: m.orders.itemsMany, total: m.cart.barTotal, updating: m.cart.updating }}
      />
    </main>
  );
}
