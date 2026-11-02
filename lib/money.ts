/**
 * Money helpers. All amounts are integer paise (1 rupee = 100 paise).
 * Rupees exist only at the display edge.
 */

export type Paise = number;

export function assertPaise(value: number, label = "amount"): asserts value is Paise {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be an integer number of paise, got ${value}`);
  }
}

/**
 * Integer division rounded half-up (away from zero for .5), for non-negative
 * numerator and positive denominator. Uses only integer arithmetic.
 */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    throw new RangeError("divRoundHalfUp expects safe integers");
  }
  if (denominator <= 0) throw new RangeError("denominator must be positive");
  if (numerator < 0) return -divRoundHalfUp(-numerator, denominator);
  const quotient = Math.floor(numerator / denominator);
  const remainder = numerator - quotient * denominator;
  return remainder * 2 >= denominator ? quotient + 1 : quotient;
}

/** Percentage (e.g. 3 or 2.5) to integer basis points (300, 250). */
export function percentToBasisPoints(percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`percent must be between 0 and 100, got ${percent}`);
  }
  return Math.round(percent * 100);
}

/** Apply a percentage (in basis points) to a paise amount, rounding half-up. */
export function applyBasisPoints(amountPaise: Paise, basisPoints: number): Paise {
  assertPaise(amountPaise);
  return divRoundHalfUp(amountPaise * basisPoints, 10_000);
}

/**
 * Parse a rupee string ("8.10", "101.5", "1,180") to paise. Digits beyond two
 * decimals are rounded half-up. String-based to avoid binary float error.
 */
export function rupeesToPaise(input: string | number): Paise {
  const text = (typeof input === "number" ? input.toString() : input).replace(/,/g, "").trim();
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) throw new RangeError(`Not a rupee amount: "${input}"`);
  const [, sign, whole = "0", frac = ""] = match;
  const firstTwo = (frac + "00").slice(0, 2);
  let paise = Number(whole) * 100 + Number(firstTwo);
  const third = frac.charAt(2);
  if (third !== "" && Number(third) >= 5) paise += 1;
  return sign ? -paise : paise;
}

/** "810" -> "8.10". Plain fixed 2 decimals, no currency symbol. */
export function paiseToRupeeString(paise: Paise): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = (abs % 100).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${rupees}.${rest}`;
}

/** Indian-grouped display: 1234567 paise -> "₹12,345.67". */
export function formatINR(paise: Paise): string {
  assertPaise(paise);
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rest = (abs % 100).toString().padStart(2, "0");
  const grouped = new Intl.NumberFormat("en-IN").format(rupees);
  return `${negative ? "-" : ""}₹${grouped}.${rest}`;
}
