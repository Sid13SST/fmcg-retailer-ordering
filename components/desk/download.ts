/** POST/GET an endpoint that answers with a CSV attachment and save it in the browser. */
export async function downloadCsv(url: string, method: "POST" | "GET" = "POST"): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method });
  } catch {
    return { ok: false, message: "Network error. Check the connection and try again." };
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null;
    return { ok: false, message: body?.message ?? body?.error ?? `Export failed (HTTP ${res.status})` };
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "tally-export.csv";
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return { ok: true };
}
