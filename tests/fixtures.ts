import type { SchemeForPricing, SkuForPricing } from "@/lib/scheme-engine";

// Mirrors the three sample SKUs from the client brief (see prisma/seed.ts).
export const biscuit: SkuForPricing = {
  id: "sku-bs",
  code: "SKU-BS-075",
  caseSize: 96,
  dealerPricePerCasePaise: 810, // Rs 8.10 per case
  gstRatePercent: 18,
  stockCases: 340,
};
export const biscuitScheme: SchemeForPricing = {
  skuId: "sku-bs",
  type: "BUY_X_GET_Y_FREE",
  thresholdCases: 10,
  freeCases: 1,
  percentOff: 0,
  active: true,
};

export const detergent: SkuForPricing = {
  id: "sku-dt",
  code: "SKU-DT-1KG",
  caseSize: 20,
  dealerPricePerCasePaise: 10150, // Rs 101.50 per case
  gstRatePercent: 18,
  stockCases: 85,
};
export const detergentScheme: SchemeForPricing = {
  skuId: "sku-dt",
  type: "SLAB_PERCENT_OFF",
  thresholdCases: 5,
  freeCases: 0,
  percentOff: 3,
  active: true,
};

export const tea: SkuForPricing = {
  id: "sku-te",
  code: "SKU-TE-250",
  caseSize: 40,
  dealerPricePerCasePaise: 11800, // Rs 118.00 per case
  gstRatePercent: 5,
  stockCases: 0,
};
