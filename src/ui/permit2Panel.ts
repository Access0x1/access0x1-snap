/**
 * The signature-insight panel for a Permit2 permit to the Access0x1 router: which token, how much at most,
 * that only the router can use it and only once, and when it expires. Display only.
 */

import { Box, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';
import { formatUnits } from 'viem/utils';

import { truncateAddress } from './insightPanel';
import type { Permit2Insight } from '../signature/permit2';

/** Token facts read from the chain; absent when they could not be read safely. */
export type TokenMeta = { symbol: string; decimals: number };

/** At or above this a permit is, in practice, a permit for the whole balance. */
const UNLIMITED = 2n ** 255n;

/** Whether the permit amount is effectively unlimited. */
export function isUnlimited(amount: bigint): boolean {
  return amount >= UNLIMITED;
}

/**
 * The expiry as UTC text, with a note when it has already passed.
 * @param deadline - Unix seconds.
 * @param nowMs - The current time in milliseconds.
 * @returns A readable expiry.
 */
export function formatDeadline(deadline: bigint, nowMs: number): string {
  const ms = deadline * 1000n;
  if (ms > 8_640_000_000_000_000n) {
    return 'No expiry set';
  }
  const text = `${new Date(Number(ms)).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  return Number(ms) <= nowMs ? `${text} (already passed)` : text;
}

/**
 * Render the panel.
 * @param insight - The parsed permit.
 * @param meta - Token symbol and decimals, if read.
 * @param nowMs - The current time in milliseconds.
 * @returns A Snap UI element.
 */
export function renderPermit2Panel(insight: Permit2Insight, meta: TokenMeta | null, nowMs: number): JSXElement {
  const tokenText = meta ? `${meta.symbol} (${truncateAddress(insight.token)})` : truncateAddress(insight.token);
  const amountText = isUnlimited(insight.amount)
    ? 'No limit: the whole balance'
    : meta
      ? `${formatUnits(insight.amount, meta.decimals)} ${meta.symbol}`
      : `${insight.amount.toString()} (smallest units)`;
  return Box({
    children: [
      Heading({ children: 'Access0x1 payment permit' }),
      Row({ label: 'Token', children: Text({ children: tokenText }) }),
      Row({ label: 'At most', children: Text({ children: amountText }) }),
      Row({ label: 'Valid until', children: Text({ children: formatDeadline(insight.deadline, nowMs) }) }),
      Divider({}),
      Text({
        children:
          'Only the Access0x1 router can use this permit, once, to pay a business in the transaction you send next. The swap returns anything unused to you in that same transaction. It does not approve anything else.',
      }),
    ],
  });
}
