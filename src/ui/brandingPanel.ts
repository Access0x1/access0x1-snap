/**
 * The white-label merchant branding header — the "moment of truth" UI (ADR D4c).
 *
 * Rendered ABOVE the payment insight inside the MetaMask confirmation screen so
 * the paying customer sees the merchant's own logo, "Pay {Business Name}", and a
 * one-line description right where the wallet asks them to sign.
 *
 * Branding is DISPLAY-ONLY (doctrine #1): this header never gates, signs, or
 * blocks a payment or refund. If a merchant has no logo, we simply omit the
 * `Image` — the surface still renders cleanly. The verified badge is an icon and
 * text, never the Flask-only `critical` modal (ADR D5).
 *
 * Law #4 (truth in copy): the verified badge appears ONLY when the
 * caller resolved `verified === true` (i.e. `keccak256(name) === nameHash`); we
 * never imply a chain guarantee we don't have.
 */

import { Box, Divider, Heading, Icon, Image, Row } from '@metamask/snaps-sdk/jsx';
import type { GenericSnapElement, JSXElement } from '@metamask/snaps-sdk/jsx';

import { SnapText } from './kit';
import type { MerchantBranding } from '../types';

/** Plain words for the line under the verified badge (truthful, never stronger). */
export const VERIFIED_COPY = 'This name matches the one the business registered.';

/** The badge text next to the check icon. */
export const VERIFIED_BADGE = 'Verified business';

/**
 * The verified badge: a check icon and two short lines. Only built for a name that matched its registration.
 * @returns The badge elements, in render order.
 */
export function verifiedBadge(): GenericSnapElement[] {
  return [
    Box({
      direction: 'horizontal',
      crossAlignment: 'center',
      children: [
        Icon({ name: 'verified-filled', color: 'success', size: 'md' }),
        SnapText({ children: VERIFIED_BADGE, color: 'success', fontWeight: 'bold' }),
      ],
    }),
    SnapText({ children: VERIFIED_COPY, color: 'muted', size: 'sm' }),
  ];
}

/**
 * Build the children of the branded header from resolved branding: logo, "Pay {name}", the verified badge when the
 * name matched, then the one-line description. Returned as a flat array so the composed insight panel can spread it.
 * Pieces that are absent are simply left out.
 * @param branding - The resolved, already-sanitized branding.
 * @returns The header's child elements, in render order.
 */
export function brandingHeaderChildren(branding: MerchantBranding): GenericSnapElement[] {
  const children: GenericSnapElement[] = [];

  // Logo: inline SVG only (ADR D5). Omitted entirely when there is none.
  if (branding.logoSvg) {
    children.push(Image({ src: branding.logoSvg, alt: `${branding.name} logo` }));
  }

  children.push(Heading({ children: `Pay ${branding.name}` }));

  // The badge shows only when the hash actually matched (law #4).
  if (branding.verified) {
    children.push(...verifiedBadge());
  }

  if (branding.description.length > 0) {
    children.push(SnapText({ children: branding.description }));
  }

  return children;
}

/**
 * Render the branded header as a standalone `Box` (used by the pre-sign dialog).
 * @param branding - The resolved branding.
 * @returns A Snap JSX element.
 */
export function renderBrandingHeader(branding: MerchantBranding): JSXElement {
  return Box({ children: brandingHeaderChildren(branding) });
}

/**
 * Render the optional pre-sign confirmation body (ADR D4 path 1): the branded
 * header plus an "Amount" row, for a `snap_dialog` of type `confirmation`. The
 * confirmation type supplies its own Accept/Reject buttons.
 *
 * This is DISPLAY + CONSENT only: the dApp sends the actual pay tx (the Snap
 * cannot call `eth_sendTransaction`, ADR D5). Rejecting here is a UX courtesy,
 * never the enforcement point for a money path.
 * @param branding - The resolved branding.
 * @param amountLabel - A pre-formatted amount string (e.g. `"$29.00"` or `"12.50 USDC"`).
 * @returns A Snap JSX element for `snap_dialog`'s `content`.
 */
export function renderBrandedConfirmation(
  branding: MerchantBranding,
  amountLabel: string,
): JSXElement {
  return Box({
    children: [
      ...brandingHeaderChildren(branding),
      Divider({}),
      Row({ label: 'Amount', children: SnapText({ children: amountLabel }) }),
    ],
  });
}
