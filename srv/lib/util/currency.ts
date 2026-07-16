import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

/** Parse a raw value (string | number) into a Decimal safely. */
export function toDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  return new Decimal(value);
}

/** Multiply two values — e.g. qty * unitPrice. */
export function multiply(a: string | number, b: string | number): Decimal {
  return toDecimal(a).mul(toDecimal(b));
}

/** Absolute percentage difference between two values: |a - b| / b * 100 */
export function pctDiff(a: string | number, b: string | number): Decimal {
  const base = toDecimal(b);
  if (base.isZero()) return new Decimal(0);
  return toDecimal(a).sub(base).abs().div(base).mul(100);
}

/** Absolute difference: |a - b| */
export function absDiff(a: string | number, b: string | number): Decimal {
  return toDecimal(a).sub(toDecimal(b)).abs();
}

/** Round to 2 decimal places (for EUR amounts). */
export function roundAmount(value: Decimal | string | number): Decimal {
  return toDecimal(value.toString()).toDecimalPlaces(2);
}

/** Round to 5 decimal places (for unit prices). */
export function roundPrice(value: Decimal | string | number): Decimal {
  return toDecimal(value.toString()).toDecimalPlaces(5);
}

/** Check if a variance is within tolerance: pct% OR abs EUR (whichever is more permissive). */
export function isWithinTolerance(
  invoiceVal: string | number,
  referenceVal: string | number,
  tolerancePct: string | number,
  toleranceAbs: string | number,
): boolean {
  const diff = absDiff(invoiceVal, referenceVal);
  const pct = pctDiff(invoiceVal, referenceVal);
  return pct.lte(toDecimal(tolerancePct)) || diff.lte(toDecimal(toleranceAbs));
}
