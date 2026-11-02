/**
 * Integration-style access-control tests: the real route handlers and middleware run
 * against the test database; only the request cookie jar and the Prisma singleton are
 * swapped in.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.SESSION_SECRET = "access-test-secret-access-test-secret-0123";
  return { cookie: undefined as string | undefined };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "kod_session" && state.cookie ? { name, value: state.cookie } : undefined) }),
}));
vi.mock("@/lib/db", async () => {
  const { createTestClient } = await import("./setup/test-db");
  return { prisma: createTestClient() };
});

import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { POST as approve } from "@/app/api/desk/orders/[id]/approve/route";
import { POST as exportOrder } from "@/app/api/desk/orders/[id]/export/route";
import { PATCH as correctLine } from "@/app/api/desk/orders/[id]/lines/[lineId]/route";
import { POST as reject } from "@/app/api/desk/orders/[id]/reject/route";
import { POST as exportToday } from "@/app/api/desk/exports/today/route";
import { GET as getCredit } from "@/app/api/retailers/[id]/credit/route";
import { GET as getRetailerOrders } from "@/app/api/retailers/[id]/orders/route";
import { GET as getPrices } from "@/app/api/retailers/[id]/prices/route";
import { POST as placeOrder } from "@/app/api/retailer/orders/route";
import { signSession, SESSION_COOKIE } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { middleware } from "@/middleware";
import { resetDb } from "./setup/test-db";

const db = prisma;
afterAll(() => db.$disconnect());

const ids = { alice: "", bob: "", desk: "", sku: "", aliceOrder: "", aliceLine: "", bobOrder: "" };

async function loginAs(role: "RETAILER" | "ORDER_DESK" | null, sub = "") {
  state.cookie = role ? await signSession({ sub, role, name: role === "ORDER_DESK" ? "Neha Sharma" : "Retailer" }, process.env.SESSION_SECRET!) : undefined;
}

const p = <T extends Record<string, string>>(v: T) => ({ params: Promise.resolve(v) });
const req = (url: string, init?: RequestInit) => new Request(`http://localhost${url}`, init);
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  await resetDb(db);
  const mk = (name: string, phone: string) =>
    db.retailer.create({ data: { name, shopName: `${name} Stores`, phone, area: "Napier Town", creditLimitPaise: 5_000_000, creditUsedPaise: 0 } });
  ids.alice = (await mk("Alice", "9827000101")).id;
  ids.bob = (await mk("Bob", "9827000102")).id;
  ids.desk = (await db.deskUser.create({ data: { name: "Neha Sharma", phone: "9000000101" } })).id;
  ids.sku = (await db.sKU.create({
    data: { code: "SKU-DT-1KG", name: "Detergent powder 1 kg", brand: "T", category: "Detergent", caseSize: 20, dealerPricePerCasePaise: 10150, gstRatePercent: 18, stockCases: 85 },
  })).id;
  // Bob has a private price override; Alice must never see it.
  await db.retailerPriceOverride.create({ data: { retailerId: ids.bob, skuId: ids.sku, dealerPricePerCasePaise: 9999 } });

  for (const who of ["alice", "bob"] as const) {
    await loginAs("RETAILER", ids[who]);
    const res = await placeOrder(req("/api/retailer/orders", json({ clientRequestId: randomUUID(), lines: [{ skuId: ids.sku, qtyCases: 1 }] })));
    expect(res.status).toBe(201);
    const body = await res.json();
    ids[who === "alice" ? "aliceOrder" : "bobOrder"] = body.orderId;
  }
  ids.aliceLine = (await db.orderLine.findFirstOrThrow({ where: { orderId: ids.aliceOrder } })).id;
});

beforeEach(() => loginAs(null));

describe("a retailer cannot read another retailer's data (403)", () => {
  beforeEach(() => loginAs("RETAILER", ids.alice));

  it("orders", async () => {
    expect((await getOrder(req(`/api/orders/${ids.bobOrder}`), p({ id: ids.bobOrder }))).status).toBe(403);
    expect((await getRetailerOrders(req(`/api/retailers/${ids.bob}/orders`), p({ id: ids.bob }))).status).toBe(403);
    // Unknown ids look the same as someone else's: no probing.
    expect((await getOrder(req("/api/orders/nope"), p({ id: "nope" }))).status).toBe(403);
  });

  it("prices", async () => {
    const res = await getPrices(req(`/api/retailers/${ids.bob}/prices`), p({ id: ids.bob }));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("9999");
  });

  it("credit", async () => {
    const res = await getCredit(req(`/api/retailers/${ids.bob}/credit`), p({ id: ids.bob }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });

  it("but can read its own", async () => {
    const order = await getOrder(req(`/api/orders/${ids.aliceOrder}`), p({ id: ids.aliceOrder }));
    expect(order.status).toBe(200);
    expect((await order.json()).order.retailerId).toBe(ids.alice);
    const credit = await getCredit(req(`/api/retailers/${ids.alice}/credit`), p({ id: ids.alice }));
    expect(credit.status).toBe(200);
    expect((await credit.json()).credit.creditLimitPaise).toBe(5_000_000);
    const prices = await (await getPrices(req(`/api/retailers/${ids.alice}/prices`), p({ id: ids.alice }))).json();
    expect(prices.prices[0].dealerPricePerCasePaise).toBe(10150);
    const list = await (await getRetailerOrders(req(`/api/retailers/${ids.alice}/orders`), p({ id: ids.alice }))).json();
    expect(list.orders.map((o: { id: string }) => o.id)).toEqual([ids.aliceOrder]);
  });
});

describe("a retailer cannot use desk APIs (403) and nothing changes", () => {
  beforeEach(() => loginAs("RETAILER", ids.alice));

  it("approve / reject / correct / export are all refused, even on its own order", async () => {
    const o = p({ id: ids.aliceOrder });
    expect((await approve(req("/x", json({})), o)).status).toBe(403);
    expect((await reject(req("/x", json({ reason: "nope nope" })), o)).status).toBe(403);
    expect((await correctLine(req("/x", { ...json({ qtyCases: 50 }), method: "PATCH" }), p({ id: ids.aliceOrder, lineId: ids.aliceLine }))).status).toBe(403);
    expect((await exportOrder(req("/x", { method: "POST" }), o)).status).toBe(403);
    expect((await exportToday()).status).toBe(403);
    const order = await db.order.findUniqueOrThrow({ where: { id: ids.aliceOrder }, include: { lines: true } });
    expect(order.status).toBe("PENDING_DESK_REVIEW");
    expect(order.lines[0]!.qtyCases).toBe(1);
  });
});

describe("unauthenticated requests", () => {
  it("APIs answer 401", async () => {
    expect((await getOrder(req(`/api/orders/${ids.aliceOrder}`), p({ id: ids.aliceOrder }))).status).toBe(401);
    expect((await getCredit(req(`/api/retailers/${ids.alice}/credit`), p({ id: ids.alice }))).status).toBe(401);
    expect((await approve(req("/x", json({})), p({ id: ids.aliceOrder }))).status).toBe(401);
  });
});

describe("middleware: page routes", () => {
  async function visit(path: string, token?: string) {
    const r = new NextRequest(`http://localhost${path}`, token ? { headers: { cookie: `${SESSION_COOKIE}=${token}` } } : undefined);
    return middleware(r);
  }
  const token = (role: "RETAILER" | "ORDER_DESK", sub: string) => signSession({ sub, role, name: "x" }, process.env.SESSION_SECRET!);

  it("unauthenticated visitors are redirected to login with the page they wanted", async () => {
    for (const path of ["/desk", "/desk/orders/abc", "/retailer/orders"]) {
      const res = await visit(path);
      expect(res.status).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.pathname).toBe("/login");
      expect(loc.searchParams.get("next")).toBe(path);
    }
  });

  it("a retailer cannot reach /desk routes", async () => {
    const t = await token("RETAILER", ids.alice);
    for (const path of ["/desk", `/desk/orders/${ids.aliceOrder}`]) {
      const res = await visit(path, t);
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/retailer");
    }
  });

  it("a forged or tampered cookie counts as logged out", async () => {
    const t = await token("RETAILER", ids.alice);
    const res = await visit("/desk", t.slice(0, -2) + "xx");
    expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
  });

  it("the desk reaches /desk and the desk can act", async () => {
    const t = await token("ORDER_DESK", ids.desk);
    const res = await visit(`/desk/orders/${ids.aliceOrder}`, t);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");

    await loginAs("ORDER_DESK", ids.desk);
    expect((await getCredit(req(`/api/retailers/${ids.bob}/credit`), p({ id: ids.bob }))).status).toBe(200);
    expect((await approve(req("/x", json({})), p({ id: ids.aliceOrder }))).status).toBe(200);
    const csv = await exportOrder(req("/x", { method: "POST" }), p({ id: ids.aliceOrder }));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(csv.headers.get("content-disposition")).toMatch(/attachment; filename="tally-KOD-\d+\.csv"/);
    // Server-side transition rule over HTTP: a rejected order cannot be exported.
    expect((await reject(req("/x", json({ reason: "Duplicate order" })), p({ id: ids.bobOrder }))).status).toBe(200);
    const refused = await exportOrder(req("/x", { method: "POST" }), p({ id: ids.bobOrder }));
    expect(refused.status).toBe(409);
    expect((await refused.json()).code).toBe("INVALID_TRANSITION");
  });
});

describe("malformed ids are rejected before any query", () => {
  const bad = ["../../etc/passwd", "x".repeat(65), "a b", "id;drop", ""];

  it("retailer APIs answer 400", async () => {
    await loginAs("RETAILER", ids.alice);
    for (const id of bad) {
      expect((await getOrder(req("/api/orders/x"), p({ id }))).status, id).toBe(400);
      expect((await getCredit(req("/api/retailers/x/credit"), p({ id }))).status, id).toBe(400);
    }
  });

  it("desk APIs answer 404 and change nothing", async () => {
    await loginAs("ORDER_DESK", ids.desk);
    const before = await db.order.findUniqueOrThrow({ where: { id: ids.aliceOrder }, include: { lines: true } });
    for (const id of bad) {
      expect((await approve(req("/x", json({})), p({ id }))).status, id).toBe(404);
      expect((await correctLine(req("/x", { ...json({ qtyCases: 2 }), method: "PATCH" }), p({ id: ids.aliceOrder, lineId: id }))).status, id).toBe(404);
    }
    const after = await db.order.findUniqueOrThrow({ where: { id: ids.aliceOrder }, include: { lines: true } });
    expect(after).toEqual(before);
  });
});

describe("middleware: cross-site API writes", () => {
  const call = (method: string, origin?: string) =>
    middleware(new NextRequest("http://localhost/api/retailer/orders", { method, headers: { host: "localhost", ...(origin ? { origin } : {}) } }));

  it("refuses a POST from another origin", async () => {
    const res = await call("POST", "https://evil.example");
    expect(res.status).toBe(403);
  });

  it("allows same-origin, origin-less and read requests", async () => {
    expect((await call("POST", "http://localhost")).headers.get("x-middleware-next")).toBe("1");
    expect((await call("POST")).headers.get("x-middleware-next")).toBe("1");
    expect((await call("GET", "https://evil.example")).headers.get("x-middleware-next")).toBe("1");
  });
});
