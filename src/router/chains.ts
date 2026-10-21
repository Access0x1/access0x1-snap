/**
 * Chain id → human-readable label, plus the block-explorer base URL used to
 * build payout receipt links.
 *
 * Only the chains Access0x1 targets at the hackathon are named; anything else
 * degrades gracefully to an "Unknown Chain" label so the panel never lies.
 */

/** Arc Testnet — Access0x1's primary settlement chain (native USDC). */
export const ARC_TESTNET = 5042002;
/** Base Sepolia. */
export const BASE_SEPOLIA = 84532;
/** zkSync Sepolia Testnet. */
export const ZKSYNC_SEPOLIA = 300;

/** Mainnets Access0x1 is live on, at one router address on every chain. */
export const ETHEREUM = 1;
export const BASE = 8453;
export const UNICHAIN = 130;
export const ARC = 5042;
export const MAINNET_ROUTER: `0x${string}` = '0xe92244e3368561faf21648146511DeDE3a475EB5';
const MAINNETS = [ETHEREUM, BASE, UNICHAIN, ARC];
/** The mainnet chain ids, in display order. */
export const MAINNET_IDS: readonly number[] = MAINNETS;

/**
 * The router on a chain Access0x1 is live on, used when no app has configured one; null elsewhere.
 * @param chainId - The numeric chain id.
 * @returns The router address, or null.
 */
export function defaultRouterFor(chainId: number): `0x${string}` | null {
  return MAINNETS.includes(chainId) ? MAINNET_ROUTER : null;
}

/**
 * Whether the chain is one of the mainnets Access0x1 is live on today (for labels and the home page).
 * @param chainId - The numeric chain id.
 * @returns True when the chain is a live mainnet.
 */
export function isLiveMainnet(chainId: number): boolean {
  return MAINNETS.includes(chainId);
}

/** CAIP-2 ids of the mainnets, for the name-lookup permission. */
export const MAINNET_CAIP2 = MAINNETS.map((id) => `eip155:${id}`);

/**
 * The router for a chain: the one an app configured for that chain, else the default on a mainnet, else null.
 * @param configured - The persisted router config, or null.
 * @param chainId - Numeric EVM chain id.
 * @returns The router address, or null.
 */
export function routerForChain(
  configured: { routerAddress: `0x${string}`; chainIds: number[] } | null,
  chainId: number,
): `0x${string}` | null {
  if (configured?.chainIds.includes(chainId)) {
    return configured.routerAddress;
  }
  return defaultRouterFor(chainId);
}

const CHAIN_LABELS: Record<number, string> = {
  [ETHEREUM]: 'Ethereum',
  [BASE]: 'Base',
  [UNICHAIN]: 'Unichain',
  [ARC]: 'Arc',
  [ARC_TESTNET]: 'Arc Testnet',
  [BASE_SEPOLIA]: 'Base Sepolia',
  [ZKSYNC_SEPOLIA]: 'zkSync Sepolia',
};

/**
 * Resolve a human-readable label for an EVM chain id.
 * @param chainId - Numeric EVM chain id.
 * @returns The chain's name, or `"Unknown Chain (id: <id>)"` for unrecognized ids.
 */
export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `Unknown Chain (id: ${chainId})`;
}

/**
 * Block-explorer transaction-link base for a chain. Defaults to Arcscan testnet,
 * the chain the live app settles on.
 * @param chainId - Numeric EVM chain id.
 * @returns The explorer base URL ending in `/tx/`.
 */
export function explorerTxBase(chainId: number): string {
  switch (chainId) {
    case ETHEREUM:
      return 'https://etherscan.io/tx/';
    case BASE:
      return 'https://basescan.org/tx/';
    case UNICHAIN:
      return 'https://uniscan.xyz/tx/';
    case ARC:
      return 'https://arcscan.app/tx/';
    case BASE_SEPOLIA:
      return 'https://sepolia.basescan.org/tx/';
    case ZKSYNC_SEPOLIA:
      return 'https://sepolia.explorer.zksync.io/tx/';
    case ARC_TESTNET:
    default:
      return 'https://testnet.arcscan.app/tx/';
  }
}

/**
 * A block-explorer page for an address, on the chains Access0x1 knows. Unknown chains get no link rather than a
 * link to the wrong explorer.
 * @param chainId - Numeric EVM chain id.
 * @param address - The address to open.
 * @returns The explorer URL, or null when the chain is not one we know.
 */
export function explorerAddressUrl(chainId: number, address: `0x${string}`): string | null {
  if (!(chainId in CHAIN_LABELS)) {
    return null;
  }
  return `${explorerTxBase(chainId).replace(/\/tx\/$/u, '/address/')}${address}`;
}

/**
 * The name of a chain's own coin as a person knows it, for "You pay with ...".
 * @param chainId - Numeric EVM chain id.
 * @returns "ETH" on the chains that use it, otherwise a neutral "Native coin".
 */
export function nativeCoinLabel(chainId: number): string {
  return [ETHEREUM, BASE, UNICHAIN, BASE_SEPOLIA].includes(chainId) ? 'ETH' : 'Native coin';
}

/**
 * The router a transaction is addressed to, or null. Only a transaction sent TO the router (an app's configured one, or
 * the address the router has on every chain) gets a payment panel; a look-alike call to another contract gets none.
 * @param to - The transaction's `to`.
 * @param configured - The router an app configured, if any.
 * @param chainId - The numeric chain id.
 * @returns The matching router address, or null.
 */
export function routerTarget(
  to: string | null | undefined,
  configured: string | null | undefined,
  chainId: number,
): `0x${string}` | null {
  const target = (to ?? '').toLowerCase();
  if (!target) {
    return null;
  }
  const candidates = [configured, defaultRouterFor(chainId) ?? MAINNET_ROUTER].filter(
    (a): a is `0x${string}` => typeof a === 'string' && a.length === 42,
  );
  return candidates.find((a) => a.toLowerCase() === target) ?? null;
}
