import "server-only";
import { prisma } from "@/lib/db";
import type { Role } from "./roles";

export type LoginIdentity = { id: string; role: Role; name: string };

/** Find who owns a phone number. Desk users and retailers have disjoint phones. */
export async function findIdentityByPhone(phone: string): Promise<LoginIdentity | null> {
  const [desk, retailer] = await Promise.all([
    prisma.deskUser.findUnique({ where: { phone } }),
    prisma.retailer.findUnique({ where: { phone } }),
  ]);
  if (desk && retailer) throw new Error(`Phone ${phone} belongs to both a desk user and a retailer`);
  if (desk) return { id: desk.id, role: "ORDER_DESK", name: desk.name };
  if (retailer) return { id: retailer.id, role: "RETAILER", name: retailer.name };
  return null;
}
