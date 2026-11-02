import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

/**
 * Integration tests use their own throwaway SQLite file (prisma/test.db), never dev.db.
 * Recreate it from scratch and apply all migrations.
 */
export default function setup() {
  const file = path.resolve(__dirname, "../../prisma/test.db");
  for (const f of [file, `${file}-journal`]) rmSync(f, { force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: `file:${file}` },
  });
}
