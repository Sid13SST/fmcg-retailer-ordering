import "server-only";
import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { DESK_ERROR_HTTP, type DeskFailure } from "./actions";

export function deskFailure(result: DeskFailure): NextResponse {
  return NextResponse.json({ ...result, error: result.code }, { status: DESK_ERROR_HTTP[result.code] });
}

export function invalidInput(error: ZodError): NextResponse {
  return NextResponse.json({ error: "INVALID_INPUT", message: error.issues[0]?.message ?? "Invalid input", issues: error.issues }, { status: 400 });
}

/** CSV as a browser download. */
export function csvDownload(csv: string, fileName: string, extraHeaders: Record<string, string> = {}): NextResponse {
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.-]/g, "_")}"`,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}
