import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/current-user";
import { ROLE_HOME } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  redirect(session ? ROLE_HOME[session.role] : "/login");
}
