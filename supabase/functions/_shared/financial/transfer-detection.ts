import { directionOf, isCreditAccount, resolveMatchedSubtype } from './classification.ts';
import type {
  AccountContext,
  ClassifiableTransaction,
  ExistingMatch,
  MatchSignal,
  ProposedMatch,
} from './types.ts';

/**
 * Internal transfer detection.
 *
 * Finds pairs of transactions that are two halves of one movement between the
 * user's own accounts: $2,000 leaving chequing and $2,000 arriving in savings
 * is one event, not $2,000 of spending plus $2,000 of income.
 *
 * ## Confidence, not certainty
 *
 * Every candidate pair is scored. High-scoring pairs are matched automatically;
 * middling ones go to review and, crucially, **keep counting as spending until
 * a human confirms them**. Silently removing $4,700 from someone's spending on
 * a guess is worse than asking.
 *
 * ## Determinism and idempotency
 *
 * Detection is a pure function of its inputs. Given the same transactions it
 * produces the same matches, in the same order, with the same scores. Pairs
 * that already exist — including ones the user rejected — are skipped, so
 * re-running after every sync converges rather than churning.
 *
 * ## Credit card payments
 *
 * A payment from chequing to a credit card is only excluded from spending when
 * the card is connected AND the payment matches an inflow on it. If the card is
 * not connected, its purchases were never counted, so the payment IS the
 * spending record and must stay. Nothing is excluded merely for containing the
 * word "PAYMENT".
 */

export type DetectionOptions = {
  /** Maximum days between the two legs. Cross-institution transfers are slow. */
  maxDayWindow: number;
  /** At or above this confidence, match automatically. */
  autoMatchThreshold: number;
  /** Below this, do not propose a match at all. */
  reviewThreshold: number;
};

export const DEFAULT_DETECTION_OPTIONS: DetectionOptions = {
  maxDayWindow: 7,
  autoMatchThreshold: 0.9,
  reviewThreshold: 0.55,
};

export type DetectionInput = {
  transactions: readonly ClassifiableTransaction[];
  accounts: readonly AccountContext[];
  existingMatches: readonly ExistingMatch[];
  /** Transaction ids flagged as transfer candidates by classification. */
  transferCandidateIds?: ReadonlySet<string>;
  options?: Partial<DetectionOptions>;
};

export function detectTransfers(input: DetectionInput): ProposedMatch[] {
  const options = { ...DEFAULT_DETECTION_OPTIONS, ...input.options };
  const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
  const candidateIds = input.transferCandidateIds ?? new Set<string>();

  // Pending transactions are excluded: they are replaced by a posted version,
  // and matching against one produces a pair that evaporates on the next sync.
  const eligible = input.transactions.filter(
    (transaction) => !transaction.pending && accountsById.has(transaction.accountId),
  );

  const outflows = eligible.filter((transaction) => directionOf(transaction.amount) === 'OUTFLOW');
  const inflows = eligible.filter((transaction) => directionOf(transaction.amount) === 'INFLOW');

  // A pair is never re-proposed, whatever became of it. This is what makes
  // repeated runs idempotent, and what makes a rejection stick.
  const seenPairs = new Set(
    input.existingMatches.map((match) => pairKey(match.outgoingTransactionId, match.incomingTransactionId)),
  );
  const lockedTransactionIds = new Set(
    input.existingMatches
      .filter((match) => match.status !== 'USER_REJECTED')
      .flatMap((match) => [match.outgoingTransactionId, match.incomingTransactionId]),
  );

  const scored: ProposedMatch[] = [];

  for (const outgoing of outflows) {
    if (lockedTransactionIds.has(outgoing.id)) continue;
    const fromAccount = accountsById.get(outgoing.accountId)!;

    for (const incoming of inflows) {
      if (lockedTransactionIds.has(incoming.id)) continue;
      if (seenPairs.has(pairKey(outgoing.id, incoming.id))) continue;

      const toAccount = accountsById.get(incoming.accountId)!;
      const evaluation = scorePair({
        outgoing,
        incoming,
        fromAccount,
        toAccount,
        options,
        outgoingIsCandidate: candidateIds.has(outgoing.id),
        incomingIsCandidate: candidateIds.has(incoming.id),
      });

      if (!evaluation) continue;
      if (evaluation.confidence < options.reviewThreshold) continue;

      scored.push({
        outgoingTransactionId: outgoing.id,
        incomingTransactionId: incoming.id,
        confidence: evaluation.confidence,
        subtype: resolveMatchedSubtype(fromAccount, toAccount),
        status:
          evaluation.confidence >= options.autoMatchThreshold ? 'AUTO_MATCHED' : 'NEEDS_REVIEW',
        detectionMethod: 'HEURISTIC_V1',
        reasons: evaluation.signals,
      });
    }
  }

  return assignGreedily(scored);
}

/**
 * Resolves competing proposals into a 1:1 assignment.
 *
 * One outflow can plausibly pair with several inflows — two $500 transfers on
 * the same day, for instance. Taking the highest-confidence pair first and
 * consuming both legs avoids one transaction being counted in two matches,
 * which the database's partial unique indexes would reject anyway.
 *
 * Ties are broken by transaction id so the result never depends on input order.
 */
function assignGreedily(proposals: readonly ProposedMatch[]): ProposedMatch[] {
  const sorted = [...proposals].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.outgoingTransactionId.localeCompare(b.outgoingTransactionId) ||
      a.incomingTransactionId.localeCompare(b.incomingTransactionId),
  );

  const used = new Set<string>();
  const assigned: ProposedMatch[] = [];

  for (const proposal of sorted) {
    if (used.has(proposal.outgoingTransactionId) || used.has(proposal.incomingTransactionId)) {
      continue;
    }
    used.add(proposal.outgoingTransactionId);
    used.add(proposal.incomingTransactionId);
    assigned.push(proposal);
  }

  return assigned;
}

type ScoreInput = {
  outgoing: ClassifiableTransaction;
  incoming: ClassifiableTransaction;
  fromAccount: AccountContext;
  toAccount: AccountContext;
  options: DetectionOptions;
  outgoingIsCandidate: boolean;
  incomingIsCandidate: boolean;
};

type Evaluation = { confidence: number; signals: MatchSignal[] };

/**
 * Scores one candidate pair, or returns null if it is disqualified outright.
 *
 * Disqualifiers are hard requirements — no amount of other evidence should
 * pair two transactions on the same account, or in different currencies.
 */
export function scorePair(input: ScoreInput): Evaluation | null {
  const { outgoing, incoming, fromAccount, toAccount, options } = input;

  // --- Hard requirements ---------------------------------------------------
  if (outgoing.accountId === incoming.accountId) return null;

  const outgoingCurrency = outgoing.currency ?? fromAccount.currency;
  const incomingCurrency = incoming.currency ?? toAccount.currency;
  // Cross-currency transfers are real, but pairing them requires an FX rate we
  // do not have. Matching on the raw numbers would be arithmetic nonsense.
  if (outgoingCurrency !== incomingCurrency) return null;

  const dayDelta = daysBetween(outgoing.postedDate, incoming.postedDate);
  if (dayDelta === null || dayDelta > options.maxDayWindow) return null;

  const outgoingAmount = Math.abs(outgoing.amount);
  const incomingAmount = Math.abs(incoming.amount);
  if (outgoingAmount === 0 || incomingAmount === 0) return null;

  const amountDelta = Math.abs(outgoingAmount - incomingAmount);
  const relativeDelta = amountDelta / Math.max(outgoingAmount, incomingAmount);
  // Beyond 2% the pair is not the same movement of money.
  if (relativeDelta > 0.02) return null;

  const signals: MatchSignal[] = [];
  let confidence = 0;

  // --- Amount --------------------------------------------------------------
  if (amountDelta < 0.01) {
    confidence += 0.4;
    signals.push({
      signal: 'AMOUNT_EXACT',
      detail: `Both legs are ${formatAmount(outgoingAmount)}`,
      weight: 0.4,
    });
  } else if (relativeDelta <= 0.01) {
    confidence += 0.28;
    signals.push({
      signal: 'AMOUNT_NEAR',
      detail: `Amounts differ by ${formatAmount(amountDelta)}, under 1%`,
      weight: 0.28,
    });
  } else {
    confidence += 0.18;
    signals.push({
      signal: 'AMOUNT_APPROXIMATE',
      detail: `Amounts differ by ${formatAmount(amountDelta)}, under 2%`,
      weight: 0.18,
    });
  }

  // --- Timing --------------------------------------------------------------
  // Same-day is the strongest timing signal; a week apart is weak but possible
  // for cross-institution transfers.
  const timingWeight = dayDelta <= 1 ? 0.22 : dayDelta <= 3 ? 0.16 : dayDelta <= 5 ? 0.1 : 0.04;
  confidence += timingWeight;
  signals.push({
    signal: 'TIMING',
    detail:
      dayDelta === 0
        ? 'Both legs posted on the same day'
        : `Legs posted ${dayDelta} day${dayDelta === 1 ? '' : 's'} apart`,
    weight: timingWeight,
  });

  // --- Plaid's own opinion -------------------------------------------------
  if (input.outgoingIsCandidate && input.incomingIsCandidate) {
    confidence += 0.2;
    signals.push({
      signal: 'PLAID_TRANSFER_BOTH',
      detail: 'Your bank categorised both legs as transfers',
      weight: 0.2,
    });
  } else if (input.outgoingIsCandidate || input.incomingIsCandidate) {
    confidence += 0.1;
    signals.push({
      signal: 'PLAID_TRANSFER_ONE',
      detail: 'Your bank categorised one leg as a transfer',
      weight: 0.1,
    });
  }

  // --- Credit card payment -------------------------------------------------
  /*
   * The card must be connected for this to fire at all: `toAccount` only exists
   * because the inflow landed on an account we hold. That is exactly the
   * condition under which excluding the payment is correct — the purchases on
   * that card are already counted, so counting the payment too would
   * double-count them.
   */
  if (isCreditAccount(toAccount) && !isCreditAccount(fromAccount)) {
    confidence += 0.12;
    signals.push({
      signal: 'CREDIT_CARD_PAYMENT',
      detail: 'Payment into a connected credit card whose purchases are already counted',
      weight: 0.12,
    });
  }

  // --- Description ---------------------------------------------------------
  const descriptionScore = describeSimilarity(outgoing, incoming);
  if (descriptionScore) {
    confidence += descriptionScore.weight;
    signals.push(descriptionScore);
  }

  // --- Same institution ----------------------------------------------------
  if (
    fromAccount.institutionId &&
    fromAccount.institutionId === toAccount.institutionId
  ) {
    confidence += 0.06;
    signals.push({
      signal: 'SAME_INSTITUTION',
      detail: 'Both accounts are at the same institution',
      weight: 0.06,
    });
  }

  return { confidence: Math.min(1, roundTo4(confidence)), signals };
}

const TRANSFER_KEYWORDS = [
  'transfer',
  'tfr',
  'xfer',
  'payment',
  'pmt',
  'e-transfer',
  'etransfer',
  'interac',
  'withdrawal',
  'deposit',
  'to savings',
  'from savings',
];

/**
 * Looks for shared vocabulary between the two descriptions.
 *
 * Deliberately weak: matching on "PAYMENT" alone is how naive implementations
 * exclude a mortgage payment from spending. It contributes a small nudge and
 * can never carry a pair on its own.
 */
function describeSimilarity(
  outgoing: ClassifiableTransaction,
  incoming: ClassifiableTransaction,
): MatchSignal | null {
  const outgoingText = `${outgoing.merchantName ?? ''} ${outgoing.name}`.toLowerCase();
  const incomingText = `${incoming.merchantName ?? ''} ${incoming.name}`.toLowerCase();

  const sharedKeyword = TRANSFER_KEYWORDS.find(
    (keyword) => outgoingText.includes(keyword) && incomingText.includes(keyword),
  );
  if (sharedKeyword) {
    return {
      signal: 'DESCRIPTION_KEYWORD',
      detail: `Both descriptions mention "${sharedKeyword}"`,
      weight: 0.08,
    };
  }

  const sharedToken = significantSharedToken(outgoingText, incomingText);
  if (sharedToken) {
    return {
      signal: 'DESCRIPTION_TOKEN',
      detail: `Both descriptions mention "${sharedToken}"`,
      weight: 0.05,
    };
  }

  return null;
}

function significantSharedToken(a: string, b: string): string | null {
  const tokenize = (value: string) =>
    value
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !/^\d+$/.test(token));

  const bTokens = new Set(tokenize(b));
  for (const token of tokenize(a)) {
    if (bTokens.has(token)) return token;
  }
  return null;
}

/** Whole days between two `yyyy-MM-dd` dates, or null if either is unparseable. */
export function daysBetween(a: string, b: string): number | null {
  const first = Date.parse(`${a}T00:00:00Z`);
  const second = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(first) || Number.isNaN(second)) return null;
  return Math.abs(Math.round((second - first) / 86_400_000));
}

function pairKey(outgoingId: string, incomingId: string): string {
  return `${outgoingId}::${incomingId}`;
}

function formatAmount(value: number): string {
  return `$${value.toFixed(2)}`;
}

function roundTo4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
