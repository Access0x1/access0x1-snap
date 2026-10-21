/**
 * The readable payment insight panel — the PRIMARY Snap surface.
 *
 * Renders inside the MetaMask confirmation screen when the user is about to
 * sign a router `payNative` / `payToken` call. Built with the `@metamask/snaps-sdk`
 * JSX components called as plain functions (no JSX transform needed), so the
 * panel structure is fully type-checked and unit-testable.
 *
 * Law #4 (truth in copy): this panel never says "anonymous" or "untraceable";
 * it states exactly what is on-chain — amount, token, fee split, merchant, chain.
 */

import { Address, Box, Divider, Heading, Link, Row, Section } from '@metamask/snaps-sdk/jsx';
import type { GenericSnapElement, JSXElement } from '@metamask/snaps-sdk/jsx';

import { brandingHeaderChildren } from './brandingPanel';
import { SnapText } from './kit';
import { explorerAddressUrl, nativeCoinLabel } from '../router/chains';
import { formatUsd } from '../router/decode';
import type { MerchantBranding, MerchantInfo, PaymentSummary } from '../types';

/** Basis-point denominator (10_000 = 100%). */
const FEE_DENOMINATOR = 10000n;

/**
 * Truncate an address to `0x1234…cdef` for compact display.
 * @param address - A 20-byte hex address.
 * @returns The truncated form.
 */
export function truncateAddress(address: `0x${string}`): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The label for the token being paid: `"Native"` for a native-coin payment,
 * otherwise the truncated ERC-20 address.
 * @param token - The token address, or `null` for native.
 * @returns A display string for the token.
 */
export function tokenLabel(token: `0x${string}` | null): string {
  return token === null ? 'Native' : truncateAddress(token);
}

/**
 * Compute the fee split from a USD amount and the merchant's combined fee bps.
 *
 * Display-only: the precise on-chain split is computed in-contract against the
 * live price feed. This mirrors it for the panel using `usdAmount8` so the
 * numbers shown are in the merchant's exact USD units.
 * @param usdAmount8 - Gross price scaled by 1e8.
 * @param feeBps - The merchant surcharge in bps (combined fee shown to the user).
 * @returns The fee and net amounts, both 8-decimal USD.
 */
export function computeFeeSplit(
  usdAmount8: bigint,
  feeBps: number,
): { fee: bigint; net: bigint } {
  const fee = (usdAmount8 * BigInt(feeBps)) / FEE_DENOMINATOR;
  return { fee, net: usdAmount8 - fee };
}

/**
 * The fee split under the router's fee rule: the rule's share of the gross, never below its minimum (and never above
 * the gross), plus the merchant's own surcharge. Display-only, in the merchant's exact USD units.
 * @param usdAmount8 - Gross price scaled by 1e8.
 * @param ruleBps - The rule's fee in bps (feeRuleOf).
 * @param minUsd8 - The rule's minimum fee, scaled by 1e8 (0n: none).
 * @param surchargeBps - The merchant's own surcharge in bps.
 * @returns The fee and net amounts, both 8-decimal USD.
 */
export function computeRuleFeeSplit(
  usdAmount8: bigint,
  ruleBps: number,
  minUsd8: bigint,
  surchargeBps: number,
): { fee: bigint; net: bigint } {
  let platform = (usdAmount8 * BigInt(ruleBps)) / FEE_DENOMINATOR;
  if (platform < minUsd8) platform = minUsd8;
  if (platform > usdAmount8) platform = usdAmount8;
  let fee = platform + (usdAmount8 * BigInt(surchargeBps)) / FEE_DENOMINATOR;
  if (fee > usdAmount8) fee = usdAmount8;
  return { fee, net: usdAmount8 - fee };
}

/**
 * The merchant label shown in the "Merchant" row. Prefers the white-label
 * branding name when present (so the row matches the branded header); otherwise
 * falls back to the on-chain-resolved `MerchantInfo.name` ("Merchant #<id>").
 * @param merchant - The on-chain-resolved merchant info.
 * @param branding - Optional resolved white-label branding.
 * @returns The display label for the Merchant row.
 */
function merchantRowLabel(
  merchant: MerchantInfo,
  branding?: MerchantBranding,
): string {
  return branding?.name ?? merchant.name;
}

/** Token symbols read from the chain, when they could be read; the panel falls back to short addresses. */
export type TokenSymbols = { payWith?: string; settlement?: string };

/**
 * The header's top: the branded header when there is branding, otherwise the merchant's own name under a small label.
 * @param merchant - The resolved merchant.
 * @param branding - Optional resolved branding.
 * @returns The header elements.
 */
function headerElements(merchant: MerchantInfo, branding?: MerchantBranding): GenericSnapElement[] {
  if (branding) {
    return brandingHeaderChildren(branding);
  }
  return [SnapText({ children: 'Access0x1 Payment', color: 'muted', size: 'sm' }), Heading({ children: merchant.name })];
}

/**
 * The words for one side of a payment: a symbol if we read one, the chain's own coin for native, else a short address.
 * @param token - The token address, or null for the chain's own coin.
 * @param chainId - The numeric chain id.
 * @param symbol - The token symbol, if it was read.
 * @returns A short label.
 */
function coinWords(token: `0x${string}` | null, chainId: number, symbol?: string): string {
  if (token === null) {
    return nativeCoinLabel(chainId);
  }
  return symbol ?? truncateAddress(token);
}

/**
 * Rows for one token. A token's symbol is chosen by whoever made the token, so it is never the only thing shown: an
 * ERC-20 always gets its address on a row of its own, in the wallet's Address component.
 * @param label - The row label for the token's name.
 * @param addressLabel - The row label for its address.
 * @param token - The token address, or null for the chain's own coin.
 * @param chainId - The numeric chain id.
 * @param symbol - The token symbol, if it was read.
 * @returns One row for the chain's own coin, two for an ERC-20.
 */
function tokenRows(
  label: string,
  addressLabel: string,
  token: `0x${string}` | null,
  chainId: number,
  symbol?: string,
): GenericSnapElement[] {
  if (token === null) {
    return [Row({ label, children: SnapText({ children: nativeCoinLabel(chainId) }) })];
  }
  return [
    Row({ label, children: SnapText({ children: symbol ?? 'Token' }) }),
    Row({ label: addressLabel, children: Address({ address: token, truncate: true }) }),
  ];
}

/**
 * The "how it is paid" block for a pay-with-any-token payment: the path in one line, then what happens to leftovers.
 * @param summary - The decoded payment (must carry `swap`).
 * @param symbols - Token symbols, if read.
 * @returns The block's elements.
 */
function swapPath(summary: PaymentSummary, symbols?: TokenSymbols): GenericSnapElement[] {
  const payWith = coinWords(summary.swap?.payWith ?? null, summary.chainId, symbols?.payWith);
  const paidIn = coinWords(summary.token, summary.chainId, symbols?.settlement);
  return [
    SnapText({ children: 'How it is paid', fontWeight: 'bold' }),
    SnapText({ children: `You pay with ${payWith}  →  Uniswap  →  merchant paid in ${paidIn}` }),
    SnapText({
      children: 'Uniswap swaps it inside this same payment. Anything unused comes back to you.',
      color: 'muted',
      size: 'sm',
    }),
  ];
}

/**
 * Render the payment insight panel for a decoded router call.
 *
 * Layout, top to bottom: the header (merchant name with a verified badge when the name matched, then the amount in
 * large type), a Section with what the merchant receives and the fee, a Divider, then the details (how it is paid,
 * the payout address with an explorer link, network, order). Branding is display-only and additive: with none, the
 * header shows the merchant's own name.
 * @param summary - The decoded `PaymentSummary` from `parseRouterCall`.
 * @param merchant - The resolved merchant info from `fetchMerchantName`.
 * @param branding - Optional resolved white-label branding (ADR unit 7).
 * @param symbols - Optional token symbols read from the chain.
 * @returns A Snap JSX element to return as `{ content }` from `onTransaction`.
 */
export function renderInsightPanel(
  summary: PaymentSummary,
  merchant: MerchantInfo,
  branding?: MerchantBranding,
  symbols?: TokenSymbols,
): JSXElement {
  // The on-chain fee is platformFeeBps + the merchant surcharge (see _splitFee).
  // Showing only merchant.feeBps understated the fee and overstated the net — a
  // truthfulness failure on the signing screen. The contract caps the sum at
  // MAX_FEE_BPS at registration, so no re-cap is needed here.
  const { fee, net } = computeRuleFeeSplit(
    summary.usdAmount8,
    merchant.platformFeeBps,
    merchant.minFeeUsd8 ?? 0n,
    merchant.feeBps,
  );

  const explorerUrl = explorerAddressUrl(summary.chainId, merchant.payout);

  const details: GenericSnapElement[] = [
    ...(summary.swap ? swapPath(summary, symbols) : []),
    Row({ label: 'Business', children: SnapText({ children: merchantRowLabel(merchant, branding) }) }),
    Row({ label: 'Paid to', children: Address({ address: merchant.payout, truncate: true }) }),
    ...(explorerUrl ? [Link({ href: explorerUrl, children: 'View this address on the explorer' })] : []),
    ...(summary.swap
      ? [
          ...tokenRows('You pay with', 'Pay token address', summary.swap.payWith, summary.chainId, symbols?.payWith),
          ...tokenRows('Merchant paid in', 'Paid token address', summary.token, summary.chainId, symbols?.settlement),
        ]
      : tokenRows('Paid in', 'Token address', summary.token, summary.chainId, symbols?.settlement)),
    Row({ label: 'Network', children: SnapText({ children: summary.chainLabel }) }),
    Row({ label: 'Order', children: SnapText({ children: summary.orderIdLabel }) }),
  ];

  return Box({
    children: [
      ...headerElements(merchant, branding),
      Heading({ size: 'lg', children: formatUsd(summary.usdAmount8) }),
      Section({
        children: [
          Row({ label: 'Merchant receives', children: SnapText({ children: formatUsd(net), fontWeight: 'bold' }) }),
          Row({ label: 'Fee', children: SnapText({ children: formatUsd(fee) }) }),
        ],
      }),
      Divider({}),
      ...details,
    ],
  });
}
