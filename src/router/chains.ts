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
export const MAINNET_ROUTER = '0xe92244e3368561faf21648146511DeDE3a475EB5' as const;
const MAINNETS = [ETHEREUM, BASE, UNICHAIN, ARC];
/** The mainnet chain ids, in display order. */
export const MAINNET_IDS: readonly number[] = MAINNETS;

/** The router on a chain Access0x1 is live on, used when no app has configured one; null elsewhere. */
export function defaultRouterFor(chainId: number): `0x${string}` | null {
  return MAINNETS.includes(chainId) ? MAINNET_ROUTER : null;
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
  if (configured && configured.chainIds.includes(chainId)) {
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
 *
 * @param chainId - Numeric EVM chain id.
 * @returns The chain's name, or `"Unknown Chain (id: <id>)"` for unrecognized ids.
 */
export function chainLabel(chainId: number): string {
  return CHAIN_LABELS[chainId] ?? `Unknown Chain (id: ${chainId})`;
}

/**
 * Block-explorer transaction-link base for a chain. Defaults to Arcscan testnet,
 * the chain the live app settles on.
 *
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
