import { RootJSXElementStruct } from '@metamask/snaps-sdk/jsx';
import { validate } from '@metamask/superstruct';
import { encodeFunctionResult, parseAbi } from 'viem/utils';
import { describe, expect, it, vi } from 'vitest';

import { childrenOf, collectElements, collectText } from './helpers';
import { explorerAddressUrl, nativeCoinLabel } from '../src/router/chains';
import { fetchPaymentSymbols } from '../src/signature/tokenMeta';
import type { Permit2Insight } from '../src/signature/permit2';
import type { MerchantBranding, MerchantInfo, PaymentSummary } from '../src/types';
import { VERIFIED_BADGE, VERIFIED_COPY } from '../src/ui/brandingPanel';
import { INTRO_LINES, LOGO_SVG, renderHomePage, SUPPORT_URL } from '../src/ui/homePanel';
import { renderInsightPanel } from '../src/ui/insightPanel';
import { isExpired, renderPermit2Panel } from '../src/ui/permit2Panel';

const PAYOUT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;
const USDC = '0x1111111111111111111111111111111111111111' as const;
const WETH = '0x2222222222222222222222222222222222222222' as const;

const MERCHANT: MerchantInfo = { id: 7n, name: 'Merchant #7', payout: PAYOUT, feeBps: 500, platformFeeBps: 100 };
const BRANDING: MerchantBranding = {
  merchantId: '7',
  name: "Joe's Barbershop",
  description: 'Fresh cuts in Brooklyn',
  logoSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
  brandColor: '#4f46e5',
  verified: true,
  updatedAt: 1,
};
const SUMMARY: PaymentSummary = {
  merchantId: 7n,
  usdAmount8: 2900000000n,
  token: USDC,
  tokenAmount: 0n,
  orderId: '0x6f726465722d310000000000000000000000000000000000000000000000000',
  orderIdLabel: 'order-1',
  chainId: 8453,
  chainLabel: 'Base',
};
const SWAP: PaymentSummary = { ...SUMMARY, swap: { payWith: WETH, maxIn: 10n ** 18n, permit2: false } };

/** Words that belong in code, not on a person's screen. */
const JARGON = ['calldata', 'nameHash', 'ABI', 'selector', 'bps', 'basis point', 'EOA', 'hex', 'router', 'Permit2'];

/** The index of the first element of this type in render order. */
const firstIndex = (panel: unknown, type: string) => childrenOf(panel).findIndex((el) => (el as { type: string }).type === type);

describe('transaction insight layout', () => {
  const panel = renderInsightPanel(SUMMARY, MERCHANT, BRANDING);

  it('goes header, then a Section, then a Divider, then the details', () => {
    const types = childrenOf(panel).map((el) => (el as { type: string }).type);
    expect(types.indexOf('Section')).toBeGreaterThan(types.indexOf('Heading'));
    expect(types.indexOf('Divider')).toBe(types.indexOf('Section') + 1);
    expect(types.slice(types.indexOf('Divider') + 1)).toContain('Row');
    expect(types.slice(types.indexOf('Divider') + 1)).not.toContain('Section');
  });

  it('shows the amount in large type before the Section', () => {
    const big = childrenOf(panel).findIndex((el) => (el as { type: string; props: { size?: string } }).type === 'Heading' && (el as { props: { size?: string } }).props.size === 'lg');
    expect(big).toBeGreaterThan(-1);
    expect(big).toBeLessThan(firstIndex(panel, 'Section'));
    expect(collectText(childrenOf(panel)[big])).toContain('$29.00');
  });

  it('puts what the merchant receives and the fee in the Section', () => {
    const section = collectElements(panel, 'Section')[0]!;
    const rows = collectElements(section, 'Row').map((row) => row.props.label);
    expect(rows).toEqual(['Merchant receives', 'Fee']);
    const text = collectText(section);
    expect(text).toContain('$1.74');
    expect(text).toContain('$27.26');
  });

  it('shows a verified badge (icon and words) only when the name matched', () => {
    const icons = collectElements(panel, 'Icon').map((icon) => icon.props.name);
    expect(icons).toContain('verified-filled');
    expect(collectText(panel)).toContain(VERIFIED_BADGE);
    expect(collectText(panel)).toContain(VERIFIED_COPY);

    const unverified = renderInsightPanel(SUMMARY, MERCHANT, { ...BRANDING, verified: false });
    expect(collectElements(unverified, 'Icon')).toHaveLength(0);
    expect(collectText(unverified)).not.toContain(VERIFIED_BADGE);
    expect(collectElements(renderInsightPanel(SUMMARY, MERCHANT), 'Icon')).toHaveLength(0);
  });

  it('uses the Address component for the payout address and a Link to the explorer', () => {
    const address = collectElements(panel, 'Address').find((el) => el.props.address === PAYOUT);
    expect(address?.props.truncate).toBe(true);
    const link = collectElements(panel, 'Link')[0]!;
    expect(link.props.href).toBe(`https://basescan.org/address/${PAYOUT}`);
  });

  it('leaves the link out on a chain it does not know, rather than point at the wrong explorer', () => {
    const odd = renderInsightPanel({ ...SUMMARY, chainId: 999, chainLabel: 'Unknown Chain (id: 999)' }, MERCHANT);
    expect(collectElements(odd, 'Link')).toHaveLength(0);
  });

  it('always shows an ERC-20 address, so a made-up symbol cannot stand alone', () => {
    const withSymbol = renderInsightPanel(SUMMARY, MERCHANT, undefined, { settlement: 'USDC' });
    expect(collectText(withSymbol)).toContain('USDC');
    expect(collectElements(withSymbol, 'Address').some((el) => el.props.address === USDC)).toBe(true);
  });

  it('uses plain words', () => {
    const text = collectText(renderInsightPanel(SWAP, MERCHANT, BRANDING, { payWith: 'WETH', settlement: 'USDC' })).join(' ');
    for (const word of JARGON) expect(text.toLowerCase()).not.toContain(word.toLowerCase());
  });
});

describe('swap payment path', () => {
  it('reads "You pay with X -> Uniswap -> merchant paid in USDC"', () => {
    const text = collectText(renderInsightPanel(SWAP, MERCHANT, undefined, { payWith: 'WETH', settlement: 'USDC' }));
    expect(text).toContain('You pay with WETH  →  Uniswap  →  merchant paid in USDC');
    expect(text.join(' ')).toContain('Anything unused comes back to you');
  });

  it('names the chain coin when paying with the native coin, and falls back to short addresses', () => {
    const native = renderInsightPanel({ ...SWAP, swap: { payWith: null, maxIn: 1n, permit2: false } }, MERCHANT);
    expect(collectText(native)).toContain('You pay with ETH  →  Uniswap  →  merchant paid in 0x1111…1111');
  });

  it('has no path for a plain payment', () => {
    expect(collectText(renderInsightPanel(SUMMARY, MERCHANT)).join(' ')).not.toContain('Uniswap');
  });
});

describe('chain helpers', () => {
  it('builds explorer address links for known chains only', () => {
    expect(explorerAddressUrl(1, PAYOUT)).toBe(`https://etherscan.io/address/${PAYOUT}`);
    expect(explorerAddressUrl(130, PAYOUT)).toBe(`https://uniscan.xyz/address/${PAYOUT}`);
    expect(explorerAddressUrl(31337, PAYOUT)).toBeNull();
  });

  it('names the native coin only where it is known to be ETH', () => {
    expect(nativeCoinLabel(8453)).toBe('ETH');
    expect(nativeCoinLabel(5042)).toBe('Native coin');
  });
});

describe('fetchPaymentSymbols', () => {
  it('reads both symbols on the payment chain', async () => {
    const symbols: Record<string, string> = { [USDC]: 'USDC', [WETH]: 'WETH' };
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === 'eth_chainId') return '0x2105';
      const { to, data } = params?.[0] as { to: string; data: string };
      return data.startsWith('0x95d89b41')
        ? encodeFunctionResult({ abi: parseAbi(['function symbol() view returns (string)']), functionName: 'symbol', result: symbols[to]! })
        : encodeFunctionResult({ abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals', result: 6 });
    });
    expect(await fetchPaymentSymbols(SWAP, { request })).toEqual({ payWith: 'WETH', settlement: 'USDC' });
  });

  it('leaves out any symbol it cannot read', async () => {
    const request = vi.fn().mockRejectedValue(new Error('no node'));
    expect(await fetchPaymentSymbols(SWAP, { request })).toEqual({});
  });
});

describe('permit signature insight', () => {
  const NOW = Date.UTC(2026, 0, 1);
  const base: Permit2Insight = {
    chainId: 8453,
    token: USDC,
    amount: 25_000_000n,
    spender: PAYOUT,
    nonce: 1n,
    deadline: BigInt(Math.floor(NOW / 1000) + 3600),
  };
  const meta = { symbol: 'USDC', decimals: 6 };

  it('is calm for an ordinary permit: no Banner and no flagged row', () => {
    const panel = renderPermit2Panel(base, meta, NOW);
    expect(collectElements(panel, 'Banner')).toHaveLength(0);
    expect(collectElements(panel, 'Row').every((row) => [undefined, 'default'].includes(row.props.variant as string | undefined))).toBe(true);
    expect(collectElements(panel, 'Section')).toHaveLength(1);
  });

  it('uses the Address component for the token', () => {
    const address = collectElements(renderPermit2Panel(base, meta, NOW), 'Address')[0]!;
    expect(address.props).toMatchObject({ address: USDC, truncate: true });
  });

  it('raises a danger Banner and a critical row for an unlimited amount', () => {
    const panel = renderPermit2Panel({ ...base, amount: 2n ** 256n - 1n }, null, NOW);
    expect(collectElements(panel, 'Banner').map((b) => [b.props.title, b.props.severity])).toEqual([['No limit on this permit', 'danger']]);
    expect(collectElements(panel, 'Row').find((row) => row.props.label === 'At most')?.props.variant).toBe('critical');
  });

  it('raises a warning Banner for a permit that already expired', () => {
    const panel = renderPermit2Panel({ ...base, deadline: 1000n }, meta, NOW);
    expect(collectElements(panel, 'Banner').map((b) => b.props.severity)).toEqual(['warning']);
    expect(isExpired(1000n, NOW)).toBe(true);
    expect(isExpired(2n ** 255n, NOW)).toBe(false);
  });

  it('uses plain words', () => {
    const text = collectText(renderPermit2Panel(base, meta, NOW)).join(' ').toLowerCase();
    for (const word of ['router', 'permit2', 'calldata', 'nonce', 'spender']) expect(text).not.toContain(word);
  });
});

describe('home page', () => {
  const panel = renderHomePage(2);
  const text = collectText(panel);

  it('opens with the logo image and a heading', () => {
    const image = collectElements(panel, 'Image')[0]!;
    expect(image.props.src).toBe(LOGO_SVG);
    expect(LOGO_SVG.startsWith('<svg')).toBe(true);
    expect(LOGO_SVG).not.toContain('<!--');
    expect(text).toContain('Access0x1 Payments');
  });

  it('says what it does in three short lines', () => {
    expect(INTRO_LINES).toHaveLength(3);
    for (const line of INTRO_LINES) {
      expect(text).toContain(line);
      expect(line.length).toBeLessThan(50);
    }
  });

  it('lists the four networks', () => {
    for (const name of ['Ethereum', 'Base', 'Unichain', 'Arc']) expect(text).toContain(`•  ${name}`);
  });

  it('explains fees inside a Section', () => {
    const section = collectElements(panel, 'Section')[0]!;
    expect(collectText(section)).toContain('How fees work');
  });

  it('ends with a support link to Telegram', () => {
    const links = collectElements(panel, 'Link');
    expect(links.map((l) => l.props.href)).toEqual([SUPPORT_URL]);
    expect(SUPPORT_URL).toBe('https://t.me/access0x1');
  });

  it('uses plain words', () => {
    const lower = text.join(' ').toLowerCase();
    for (const word of ['router', 'calldata', 'nonce', 'contract', 'on-chain']) expect(lower).not.toContain(word);
  });
});

describe('every screen is a valid MetaMask UI tree', () => {
  const accepted = (tree: unknown): boolean => validate(tree, RootJSXElementStruct)[0] === undefined;

  it('rejects a tree the wallet would refuse (so the check below means something)', () => {
    expect(accepted({ type: 'Nope', props: {}, key: null })).toBe(false);
  });

  it('accepts the home page', () => {
    expect(accepted(renderHomePage(0))).toBe(true);
  });

  it('accepts the transaction insight, plain, branded, swap and native', () => {
    expect(accepted(renderInsightPanel(SUMMARY, MERCHANT))).toBe(true);
    expect(accepted(renderInsightPanel(SUMMARY, MERCHANT, BRANDING, { settlement: 'USDC' }))).toBe(true);
    expect(accepted(renderInsightPanel(SWAP, MERCHANT, BRANDING, { payWith: 'WETH', settlement: 'USDC' }))).toBe(true);
    expect(accepted(renderInsightPanel({ ...SWAP, token: null, swap: { payWith: null, maxIn: 1n, permit2: true } }, MERCHANT))).toBe(true);
  });

  it('accepts the permit panel, calm and flagged', () => {
    const insight: Permit2Insight = { chainId: 8453, token: USDC, amount: 1n, spender: PAYOUT, nonce: 1n, deadline: 1000n };
    expect(accepted(renderPermit2Panel(insight, { symbol: 'USDC', decimals: 6 }, 0))).toBe(true);
    expect(accepted(renderPermit2Panel({ ...insight, amount: 2n ** 256n - 1n }, null, 5_000_000))).toBe(true);
  });
});
