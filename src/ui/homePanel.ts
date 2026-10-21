/**
 * The Snap's home page: what it does, the four networks, and how fees work. Shown from the MetaMask Snaps menu.
 */

import { Bold, Box, Divider, Heading, Row, Text } from '@metamask/snaps-sdk/jsx';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';

import { chainLabel, MAINNET_IDS } from '../router/chains';

/**
 * Render the home page.
 * @param watching - How many merchants the user is watching for payments.
 * @returns A Snap UI element.
 */
export function renderHomePage(watching: number): JSXElement {
  return Box({
    children: [
      Heading({ children: 'Access0x1 Payments' }),
      Text({
        children:
          'See who you are paying, the fee, and what the business receives, before you sign. Works for payments in any token you hold: the swap happens in the same transaction.',
      }),
      Divider({}),
      Heading({ children: 'Networks' }),
      ...MAINNET_IDS.map((id) => Row({ label: chainLabel(id), children: Text({ children: 'Live' }) })),
      Divider({}),
      Heading({ children: 'How fees work' }),
      Text({
        children: [
          Bold({ children: 'One rule per payment. ' }),
          'The router applies the merchant\'s own fee rule if it has one, otherwise its app group\'s rule, otherwise the default. The rule can carry a minimum fee. You see the exact fee before you sign.',
        ],
      }),
      Text({
        children: [
          Bold({ children: 'The business is paid in the same transaction. ' }),
          'The router splits your payment and sends the business its share straight away. It holds nothing.',
        ],
      }),
      Divider({}),
      Row({ label: 'Merchants watched', children: Text({ children: String(watching) }) }),
    ],
  });
}
