import { CaptureView } from "@/components/retailer/capture-view";
import { ENGINE_LABEL, engineMode } from "@/lib/ai-capture";
import { getI18n } from "@/lib/i18n-server";
import { BRIEF_SAMPLE_ORDER_MESSAGE } from "@/prisma/seed-data";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  const { m } = await getI18n();
  // Decided from server env only; the key itself never reaches the browser.
  const planned = ENGINE_LABEL[engineMode() === "OFFLINE" ? "OFFLINE" : "GEMINI"];
  return (
    <main>
      <h1 className="mb-2 text-xl font-bold">{m.capture.title}</h1>
      <CaptureView
        m={{ capture: m.capture, common: m.common, cart: m.cart, catalogue: m.catalogue, checkout: m.checkout }}
        sampleMessage={BRIEF_SAMPLE_ORDER_MESSAGE}
        plannedEngineLabel={planned}
      />
    </main>
  );
}
