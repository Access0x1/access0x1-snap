/**
 * The signature-insight panel for a Permit2 permit to the Access0x1 router: which token, how much at most,
 * that only the router can use it and only once, and when it expires. Display only.
 */

import { Address, Banner, Box, Divider, Heading, Row, Section } from '@metamask/snaps-sdk/jsx';
import type { GenericSnapElement, JSXElement } from '@metamask/snaps-sdk/jsx';
import { formatUnits } from 'viem/utils';

import { SnapText } from './kit';
import type { Permit2Insight } from '../signature/permit2';

/** Token facts read from the chain; absent when they could not be read safely. */
export type TokenMeta = { symbol: string; decimals: number };

/** At or above this a permit is, in practice, a permit for the whole balance. */
const UNLIMITED = 2n ** 255n;

/**
 * Whether the permit amount is effectively unlimited.
 * @param amount - The permit amount.
 * @returns True when the permit covers the whole balance.
 */
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
 * Whether the deadline is in the past.
 * @param deadline - Unix seconds.
 * @param nowMs - The current time in milliseconds.
 * @returns True when the permit has already expired.
 */
export function isExpired(deadline: bigint, nowMs: number): boolean {
  const ms = deadline * 1000n;
  return ms <= 8_640_000_000_000_000n && Number(ms) <= nowMs;
}

/**
 * The banners for the risky cases only: no limit on the amount, or a permit that has already run out. A normal permit
 * gets none, so the screen stays calm.
 * @param insight - The parsed permit.
 * @param nowMs - The current time in milliseconds.
 * @returns Zero or more banners.
 */
function riskBanners(insight: Permit2Insight, nowMs: number): GenericSnapElement[] {
  const banners: GenericSnapElement[] = [];
  if (isUnlimited(insight.amount)) {
    banners.push(
      Banner({
        title: 'No limit on this permit',
        severity: 'danger',
        children: SnapText({
          children: 'It lets a payment use your whole balance of this token. Only continue if you trust this business.',
        }),
      }),
    );
  }
  if (isExpired(insight.deadline, nowMs)) {
    banners.push(
      Banner({
        title: 'This permit has already expired',
        severity: 'warning',
        children: SnapText({ children: 'It cannot be used any more. Ask the business for a fresh payment.' }),
      }),
    );
  }
  return banners;
}

/**
 * Render the panel: a short heading and one plain sentence, the facts in a Section, a banner only when something is
 * risky, then what the permit does and does not allow.
 * @param insight - The parsed permit.
 * @param meta - Token symbol and decimals, if read.
 * @param nowMs - The current time in milliseconds.
 * @returns A Snap UI element.
 */
export function renderPermit2Panel(insight: Permit2Insight, meta: TokenMeta | null, nowMs: number): JSXElement {
  const unlimited = isUnlimited(insight.amount);
  const amountText = unlimited
    ? 'No limit: the whole balance'
    : meta
      ? `${formatUnits(insight.amount, meta.decimals)} ${meta.symbol}`
      : `${insight.amount.toString()} (smallest units)`;
  return Box({
    children: [
      Heading({ children: 'Access0x1 payment permit' }),
      SnapText({ children: 'You are letting Access0x1 take a payment from your wallet, one time.', color: 'muted' }),
      ...riskBanners(insight, nowMs),
      Section({
        children: [
          ...(meta ? [Row({ label: 'Token', children: SnapText({ children: meta.symbol }) })] : []),
          Row({
            label: meta ? 'Token address' : 'Token',
            children: Address({ address: insight.token, truncate: true }),
          }),
          Row({
            label: 'At most',
            variant: unlimited ? 'critical' : 'default',
            children: SnapText({ children: amountText }),
          }),
          Row({
            label: 'Valid until',
            variant: isExpired(insight.deadline, nowMs) ? 'warning' : 'default',
            children: SnapText({ children: formatDeadline(insight.deadline, nowMs) }),
          }),
        ],
      }),
      Divider({}),
      SnapText({
        children:
          'Only the Access0x1 payment contract can use this, once, to pay a business in the transaction you send next. The swap returns anything unused to you in that same transaction. It does not approve anything else.',
      }),
    ],
  });
}
