/**
 * The confirmation shown when a dapp asks to watch a merchant id for payment notifications.
 */

import { Box, Heading, Row } from '@metamask/snaps-sdk/jsx';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';

import { SnapText } from './kit';
import { chainLabel } from '../router/chains';

/**
 * @param merchantId - The merchant id to watch.
 * @param chainId - The chain to watch it on.
 * @returns A Snap UI element.
 */
export function renderWatchConfirmation(merchantId: bigint, chainId: number): JSXElement {
  return Box({
    children: [
      Heading({ children: 'Watch for payments?' }),
      Row({ label: 'Merchant', children: SnapText({ children: `#${merchantId.toString()}` }) }),
      Row({ label: 'Network', children: SnapText({ children: chainLabel(chainId) }) }),
      SnapText({
        children:
          'You will get a MetaMask notification for each new payment to this merchant. New payments are checked every 10 minutes while MetaMask is open and on this network.',
      }),
    ],
  });
}
