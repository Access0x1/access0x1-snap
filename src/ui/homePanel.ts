/**
 * The Snap's home page, opened from the MetaMask Snaps menu: the logo, what the Snap does in three short lines, the
 * networks it works on, how fees work, and where to get help.
 */

import { Bold, Box, Divider, Heading, Image, Link, Row, Section } from '@metamask/snaps-sdk/jsx';
import type { JSXElement } from '@metamask/snaps-sdk/jsx';

import { SnapText } from './kit';
import iconSource from '../../images/icon.svg';
import { chainLabel, MAINNET_IDS } from '../router/chains';

/**
 * The logo for the Image component, which takes inline SVG: the icon file with the gaps between tags closed. The file
 * carries no comments, because the Snap sandbox refuses the character pair that opens one inside a string.
 */
export const LOGO_SVG = iconSource.replace(/>\s+</gu, '><').trim();

/** Where people go for help. */
export const SUPPORT_URL = 'https://t.me/access0x1';

/** What the Snap does, in three short lines. */
export const INTRO_LINES = [
  'See who you are paying before you sign.',
  'See the fee and what the business receives.',
  'Pay with any token you hold.',
] as const;

/**
 * Render the home page.
 * @param watching - How many businesses the user follows for payment notifications.
 * @returns A Snap UI element.
 */
export function renderHomePage(watching: number): JSXElement {
  return Box({
    children: [
      Box({
        alignment: 'center',
        crossAlignment: 'center',
        children: [
          Image({ src: LOGO_SVG, alt: 'Access0x1', width: 64, height: 64 }),
          Heading({ children: 'Access0x1 Payments' }),
        ],
      }),
      ...INTRO_LINES.map((line) => SnapText({ children: line })),
      Divider({}),
      Heading({ size: 'sm', children: 'Works on' }),
      ...MAINNET_IDS.map((id) => SnapText({ children: `•  ${chainLabel(id)}` })),
      Divider({}),
      Section({
        children: [
          Heading({ size: 'sm', children: 'How fees work' }),
          SnapText({
            children: [
              Bold({ children: 'One fee rule per payment. ' }),
              'The business\'s own fee rule applies if it has one, otherwise the rule for its app, otherwise the standard rule. A rule can have a minimum. You see the exact fee before you sign.',
            ],
          }),
          SnapText({
            children: [
              Bold({ children: 'Your money is never held. ' }),
              'The business is paid straight away, in the same transaction.',
            ],
          }),
        ],
      }),
      Row({ label: 'Businesses you follow', children: SnapText({ children: String(watching) }) }),
      Divider({}),
      Link({ href: SUPPORT_URL, children: 'Need help? Talk to us on Telegram' }),
    ],
  });
}
