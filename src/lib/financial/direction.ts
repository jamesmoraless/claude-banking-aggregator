/**
 * Plaid amount direction.
 *
 * Plaid's sign convention, stated once, here, and nowhere else:
 *
 *   amount > 0  →  money LEFT the account   (OUTFLOW)
 *   amount < 0  →  money ENTERED the account (INFLOW)
 *
 * This holds for every account type, which is the part that trips people up:
 *
 *   Chequing, card purchase        +82.14   OUTFLOW  you spent
 *   Chequing, payroll deposit    -4200.00   INFLOW   you were paid
 *   Chequing, payment to Visa     +500.00   OUTFLOW  money left chequing
 *   Credit card, purchase          +82.14   OUTFLOW  balance owed grew
 *   Credit card, payment received -500.00   INFLOW   balance owed shrank
 *   Credit card, merchant refund   -25.00   INFLOW   balance owed shrank
 *
 * Note the credit-card payment appears TWICE when both accounts are connected:
 * once as an outflow from chequing and once as an inflow to the card. That is a
 * single movement of money, not $1,000 of activity — which is exactly why
 * transfer matching exists.
 *
 * Rules for the rest of the codebase:
 *   - The raw `amount` column is never mutated or inverted in the database.
 *   - No component, chart or formatter may inspect the sign of `amount`.
 *     They consume `direction` and `absoluteAmount` instead.
 */

export const TransactionDirection = {
  Inflow: 'INFLOW',
  Outflow: 'OUTFLOW',
} as const;

export type TransactionDirection =
  (typeof TransactionDirection)[keyof typeof TransactionDirection];

export type SignedAmount = {
  /** Direction of movement relative to the account holding the transaction. */
  direction: TransactionDirection;
  /** Magnitude, always non-negative. This is what UI should render. */
  absoluteAmount: number;
  /** Plaid's raw value, preserved for traceability. */
  rawAmount: number;
};

/**
 * Interprets a raw Plaid amount.
 *
 * Zero is treated as an outflow of magnitude zero. It contributes nothing to
 * any total, so the choice is arithmetically inert; it is fixed here only so
 * that the SQL view and the TypeScript layer agree on every input.
 */
export function interpretPlaidAmount(rawAmount: number): SignedAmount {
  if (!Number.isFinite(rawAmount)) {
    throw new TypeError(`Transaction amount must be a finite number, received ${rawAmount}`);
  }

  return {
    direction: rawAmount >= 0 ? TransactionDirection.Outflow : TransactionDirection.Inflow,
    absoluteAmount: Math.abs(rawAmount),
    rawAmount,
  };
}

export function isOutflow(rawAmount: number): boolean {
  return interpretPlaidAmount(rawAmount).direction === TransactionDirection.Outflow;
}

export function isInflow(rawAmount: number): boolean {
  return interpretPlaidAmount(rawAmount).direction === TransactionDirection.Inflow;
}

export function absoluteAmount(rawAmount: number): number {
  return interpretPlaidAmount(rawAmount).absoluteAmount;
}

/**
 * Sign used for DISPLAY only: negative for money leaving, positive for money
 * arriving. This is the inverse of Plaid's convention because people read
 * "-$82.14" as "I spent $82.14".
 *
 * Never persist this value and never feed it back into a calculation.
 */
export function displaySignedAmount(rawAmount: number): number {
  const { direction, absoluteAmount: magnitude } = interpretPlaidAmount(rawAmount);
  return direction === TransactionDirection.Outflow ? -magnitude : magnitude;
}

/**
 * Whether two transactions move money in opposite directions — a prerequisite
 * for them being two legs of the same internal transfer.
 */
export function areOpposingDirections(amountA: number, amountB: number): boolean {
  return interpretPlaidAmount(amountA).direction !== interpretPlaidAmount(amountB).direction;
}
