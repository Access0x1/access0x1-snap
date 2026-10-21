/**
 * Access0x1 MetaMask Snap — entry point.
 *
 * Exports the two Snap lifecycle handlers:
 *  - `onTransaction`: renders the readable payment insight panel before signing.
 *  - `onRpcRequest`: a small dispatch table for dapp-invoked methods
 *    (`configure`, `setMerchantBranding`, `getRouterConfig`, `getPaymentHistory`,
 *    `getLastPaymentReceipt`).
 *
 * The Snap holds NO keys and NO funds (doctrine #1). The router address is never
 * hardcoded — it is set by the dapp's `configure` call and persisted in encrypted
 * Snap state (doctrine #7).
 */

import {
  MethodNotFoundError,
  SeverityLevel,
  SnapError,
  type Json,
  type OnCronjobHandler,
  type OnHomePageHandler,
  type OnNameLookupHandler,
  type OnRpcRequestHandler,
  type OnSignatureResponse,
  type OnSignatureHandler,
  type OnTransactionHandler,
} from '@metamask/snaps-sdk';
import '@metamask/snaps-sdk/jsx';

import {
  DEFAULT_BRANDING_API_BASE,
  resolveBranding,
  type FetchLike,
} from './branding/resolve';
import {
  MAX_DESCRIPTION_LEN,
  MAX_NAME_LEN,
  sanitizeBrandColor,
  sanitizeLogoSvg,
  sanitizeText,
} from './branding/sanitize';
import { putBranding } from './branding/store';
import { lookupAddress } from './names/lookup';
import { defaultRouterFor, routerForChain } from './router/chains';
import { parseRouterCall } from './router/decode';
import { fetchMerchantName, type EthProvider } from './router/merchant';
import {
  getState,
  recordReceipt,
  setState,
  type SnapProvider,
} from './state';
import { parsePermit2Signature } from './signature/permit2';
import { fetchTokenMeta } from './signature/tokenMeta';
import { renderBrandedConfirmation } from './ui/brandingPanel';
import { renderHomePage } from './ui/homePanel';
import { isUnlimited, renderPermit2Panel } from './ui/permit2Panel';
import {
  activeChainId,
  checkPayments,
  currentBlock,
  parseWatchParams,
  withoutWatch,
  withWatch,
} from './watch/watch';
import { renderInsightPanel } from './ui/insightPanel';
import { renderWatchConfirmation } from './ui/watchPanel';
import type { MerchantBranding, SnapConfigState } from './types';

/** The minimal EIP-1193 surface this entry uses for `eth_call`. */
type EthRequest = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Parse a CAIP-2 chain id (`"eip155:5042002"`) into a numeric EVM chain id.
 *
 * @param caip2 - The CAIP-2 chain id string from `onTransaction`.
 * @returns The numeric chain id, or `0` if it cannot be parsed.
 */
function caip2ToNumericChainId(caip2: string): number {
  const parts = caip2.split(':');
  const id = Number.parseInt(parts[1] ?? '', 10);
  return Number.isFinite(id) ? id : 0;
}

/**
 * `onTransaction` — renders the Access0x1 payment insight panel, now with the
 * white-label merchant branding header above it (ADR unit 7).
 *
 * If the transaction is not a router `payNative` / `payToken` call, returns
 * `null` (no panel, no false positive). Both the merchant lookup and the
 * branding resolution degrade gracefully and NEVER throw — branding is
 * display-only (doctrine #1), so a failed resolution simply renders the plain
 * (pre-existing) insight panel; it can never block the signing surface.
 *
 * @param args - The MetaMask `onTransaction` payload.
 * @param args.transaction - The pending transaction (only `data` is decoded).
 * @param args.chainId - The CAIP-2 chain id.
 * @returns `{ content }` with the insight panel, or `null`.
 */
export const onTransaction: OnTransactionHandler = async ({
  transaction,
  chainId,
}) => {
  const numericChainId = caip2ToNumericChainId(chainId);
  const summary = parseRouterCall(
    { data: transaction.data, value: transaction.value },
    numericChainId,
  );
  if (!summary) {
    return null;
  }

  const snapProvider = snap as unknown as SnapProvider;
  const state = await getState(snapProvider);
  // A configured router wins; on a chain Access0x1 is live on, the one mainnet router is known without configuration.
  const routerAddress = state?.routerAddress ?? defaultRouterFor(numericChainId);

  const merchant = await fetchMerchantName(
    summary.merchantId,
    numericChainId,
    routerAddress,
    ethereum as unknown as EthRequest,
    undefined,
    (transaction.from ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
  );

  // Resolve white-label branding via the D4 ladder (cache → fetch → on-chain
  // nameHash → Merchant #<id>). Wrapped so any unexpected error degrades to the
  // plain panel rather than throwing into onTransaction.
  let branding: MerchantBranding | undefined;
  try {
    branding = await resolveBranding(summary.merchantId, {
      snap: snapProvider,
      provider: ethereum as unknown as EthProvider,
      routerAddress,
      apiBaseUrl: state?.brandingApiBaseUrl ?? DEFAULT_BRANDING_API_BASE,
      fetchImpl: fetch as unknown as FetchLike,
    });
  } catch {
    branding = undefined;
  }

  return { content: renderInsightPanel(summary, merchant, branding) };
};

/**
 * `onRpcRequest` — dapp-invoked method dispatch table.
 *
 * Methods:
 *  - `configure({ routerAddress, chainIds, brandingApiBaseUrl? })` → persists config.
 *  - `getRouterConfig()` → `{ routerAddress, chainIds }`.
 *  - `getPaymentHistory({ limit })` → recent serialized receipts (max 50).
 *  - `getLastPaymentReceipt()` → the most-recent serialized receipt, or `null`.
 *  - `watchMerchant({ merchantId, chainId })` / `unwatchMerchant(...)` / `getWatches()` → opt in to
 *    (after the user confirms) or out of, or list, payment notifications for a merchant id.
 *  - `setMerchantBranding({ merchantId, name, description, logoSvg, brandColor, confirm?, amountLabel? })`
 *    → caches sanitized white-label branding (ADR unit 6); optionally shows a
 *    branded pre-sign confirmation dialog. Display-only — never gates a money path.
 *
 * @param args - The RPC payload.
 * @param args.request - The JSON-RPC request (`method` + `params`).
 * @returns The method's JSON result.
 * @throws {MethodNotFoundError} for an unknown method.
 */
export const onRpcRequest: OnRpcRequestHandler = async ({ request }) => {
  const snapProvider = snap as unknown as SnapProvider;
  const params = (request.params ?? {}) as Record<string, unknown>;

  switch (request.method) {
    case 'configure': {
      const routerAddress = params.routerAddress as `0x${string}`;
      const chainIds = (params.chainIds as number[] | undefined) ?? [];
      const prev = await getState(snapProvider);
      const brandingApiBaseUrl =
        typeof params.brandingApiBaseUrl === 'string'
          ? params.brandingApiBaseUrl
          : prev?.brandingApiBaseUrl;
      const next: SnapConfigState = {
        routerAddress,
        chainIds,
        receipts: prev?.receipts ?? [],
        ...(brandingApiBaseUrl ? { brandingApiBaseUrl } : {}),
        ...(prev?.branding ? { branding: prev.branding } : {}),
        ...(prev?.watches ? { watches: prev.watches } : {}),
      };
      await setState(snapProvider, next);
      return { ok: true };
    }

    case 'setMerchantBranding': {
      return (await handleSetMerchantBranding(
        snapProvider,
        params,
      )) as unknown as Json;
    }

    case 'getRouterConfig': {
      const state = await getState(snapProvider);
      return {
        routerAddress: state?.routerAddress ?? null,
        chainIds: state?.chainIds ?? [],
      };
    }

    case 'getPaymentHistory': {
      const limitRaw = Number(params.limit ?? 10);
      const limit = Math.max(1, Math.min(50, limitRaw));
      const state = await getState(snapProvider);
      return (state?.receipts ?? []).slice(0, limit) as unknown as Json;
    }

    case 'getLastPaymentReceipt': {
      const state = await getState(snapProvider);
      // The receipt log is stored most-recent-first (see `recordReceipt`), so
      // the head is the latest payment; `null` when nothing has been recorded.
      const last = state?.receipts?.[0] ?? null;
      return last as unknown as Json;
    }

    case 'watchMerchant': {
      return (await handleWatchMerchant(snapProvider, params)) as unknown as Json;
    }

    case 'unwatchMerchant': {
      const wanted = parseWatchParams(params);
      if (!wanted) {
        throw new SnapError('invalid_watch_params');
      }
      const state = await getState(snapProvider);
      if (state) {
        await setState(snapProvider, withoutWatch(state, wanted.chainId, wanted.merchantId.toString()));
      }
      return { ok: true };
    }

    case 'getWatches': {
      const state = await getState(snapProvider);
      return (state?.watches ?? []) as unknown as Json;
    }

    default:
      throw new MethodNotFoundError(
        `Method not found: ${request.method}`,
      ) as unknown as Error;
  }
};

/**
 * Parse a merchant id from RPC params into a non-negative `bigint`, or `null` if
 * it is missing / malformed. Accepts a number or a decimal/hex string.
 *
 * @param value - The untrusted `merchantId` param.
 * @returns The parsed id, or `null`.
 */
function parseMerchantId(value: unknown): bigint | null {
  try {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^(?:0x[0-9a-f]+|\d+)$/iu.test(value.trim())) {
      const id = BigInt(value.trim());
      return id >= 0n ? id : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Handle the `setMerchantBranding` RPC (ADR unit 6).
 *
 * Validates and sanitizes the merchant-supplied branding (name, description,
 * inline-SVG logo, brand color — see `branding/sanitize.ts`), caches it in
 * `snap_manageState` keyed by `merchantId`, and — when `confirm: true` — shows a
 * branded `snap_dialog` confirmation. Branding is DISPLAY-ONLY (doctrine #1):
 * the returned `accepted` flag is a UX courtesy and is NEVER the enforcement
 * point for a payment — the dApp sends the pay tx independently.
 *
 * @param snapProvider - The Snap runtime provider.
 * @param params - The RPC params.
 * @returns `{ ok, merchantId, cached, accepted }`.
 * @throws {SnapError} when `merchantId` or `name` is missing/unusable (a config
 *   error on the branding call itself — not a money path).
 */
async function handleSetMerchantBranding(
  snapProvider: SnapProvider,
  params: Record<string, unknown>,
): Promise<{
  ok: boolean;
  merchantId: string;
  cached: boolean;
  accepted: boolean | null;
}> {
  const merchantId = parseMerchantId(params.merchantId);
  if (merchantId === null) {
    throw new SnapError('invalid_merchant_id');
  }

  const name = sanitizeText(params.name, MAX_NAME_LEN);
  if (name.length === 0) {
    throw new SnapError('invalid_branding_name');
  }

  const branding: MerchantBranding = {
    merchantId: merchantId.toString(),
    name,
    description: sanitizeText(params.description, MAX_DESCRIPTION_LEN),
    logoSvg: sanitizeLogoSvg(params.logoSvg),
    brandColor: sanitizeBrandColor(params.brandColor),
    // Verification is decided on-chain by the resolver, never asserted by the
    // pushing page (law #4) — cache as unverified.
    verified: false,
    updatedAt: Date.now(),
  };

  await putBranding(snapProvider, branding);

  // Optional branded pre-sign confirmation (ADR D4 path 1). Best-effort: a
  // dialog failure (e.g. wallet locked, permission absent) never fails the
  // cache write and never blocks the downstream payment.
  let accepted: boolean | null = null;
  if (params.confirm === true) {
    const amountLabel =
      typeof params.amountLabel === 'string' && params.amountLabel.length > 0
        ? sanitizeText(params.amountLabel, 32)
        : 'See amount below';
    try {
      const result = await snapProvider.request({
        method: 'snap_dialog',
        params: {
          type: 'confirmation',
          content: renderBrandedConfirmation(branding, amountLabel),
        },
      });
      accepted = result === true;
    } catch {
      accepted = null;
    }
  }

  return { ok: true, merchantId: branding.merchantId, cached: true, accepted };
}

// Re-export the receipt recorder so dapp-side polling can persist a confirmed
// payment (called from a follow-up RPC once the tx lands).
export { recordReceipt };

/**
 * Handle `watchMerchant`: the user confirms in a dialog, then the merchant id is watched from the current block.
 * The wallet must be on the watched chain (the wallet's provider answers only for its own network).
 *
 * @param snapProvider - The Snap runtime provider.
 * @param params - The RPC params (`merchantId`, `chainId`).
 * @returns `{ ok, watching }`; `watching` is false if the user declined.
 * @throws {SnapError} for bad params, a wrong network, an unknown merchant, or a full watch list.
 */
async function handleWatchMerchant(
  snapProvider: SnapProvider,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; watching: boolean }> {
  const wanted = parseWatchParams(params);
  if (!wanted) {
    throw new SnapError('invalid_watch_params');
  }
  const state = await getState(snapProvider);
  const router = routerForChain(state, wanted.chainId);
  if (!router) {
    throw new SnapError('unsupported_chain');
  }
  const provider = ethereum as unknown as EthProvider;
  if ((await activeChainId(provider)) !== wanted.chainId) {
    throw new SnapError('switch_to_that_network_first');
  }
  const merchant = await fetchMerchantName(wanted.merchantId, wanted.chainId, router, provider);
  if (merchant.payout === '0x0000000000000000000000000000000000000000') {
    throw new SnapError('merchant_not_found');
  }
  const confirmed = await snapProvider.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: renderWatchConfirmation(wanted.merchantId, wanted.chainId),
    },
  });
  if (confirmed !== true) {
    return { ok: true, watching: false };
  }
  const base: SnapConfigState = state ?? { routerAddress: router, chainIds: [wanted.chainId], receipts: [] };
  const next = withWatch(base, {
    chainId: wanted.chainId,
    merchantId: wanted.merchantId.toString(),
    lastBlock: (await currentBlock(provider)).toString(),
  });
  if (!next) {
    throw new SnapError('too_many_watches');
  }
  await setState(snapProvider, next);
  return { ok: true, watching: true };
}

/**
 * `onSignature` — the Permit2 insight: shown only for a `PermitTransferFrom` whose spender is the Access0x1 router.
 *
 * @param args - The MetaMask `onSignature` payload.
 * @param args.signature - The signature request.
 * @returns `{ content }`, or `null` for anything else.
 */
export const onSignature: OnSignatureHandler = async ({ signature }) => {
  const state = await getState(snap as unknown as SnapProvider);
  const insight = parsePermit2Signature(signature, state);
  if (!insight) {
    return null;
  }
  const meta = await fetchTokenMeta(insight.token, insight.chainId, ethereum as unknown as EthProvider);
  // The runtime validates the signature response with the same struct as `onTransaction`, which accepts JSX elements;
  // this SDK version's type for it still lists only the legacy components, hence the cast.
  return {
    content: renderPermit2Panel(insight, meta, Date.now()),
    ...(isUnlimited(insight.amount) ? { severity: SeverityLevel.Critical } : {}),
  } as unknown as OnSignatureResponse;
};

/**
 * `onNameLookup` — reverse lookup only: names for an address on the four mainnets. A domain input returns `null`.
 *
 * @param args - The lookup request.
 * @returns Resolved names, or `null`.
 */
export const onNameLookup: OnNameLookupHandler = async (args) => {
  if (!args.address) {
    return null;
  }
  const snapProvider = snap as unknown as SnapProvider;
  const state = await getState(snapProvider);
  const names = await lookupAddress(args.chainId, args.address, {
    provider: ethereum as unknown as EthProvider,
    state,
    resolve: {
      snap: snapProvider,
      apiBaseUrl: state?.brandingApiBaseUrl ?? DEFAULT_BRANDING_API_BASE,
      fetchImpl: fetch as unknown as FetchLike,
    },
  });
  const [first, ...rest] = names;
  return first ? { resolvedDomains: [first, ...rest] } : null;
};

/**
 * `onHomePage` — what the Snap does, the networks, and how fees work.
 *
 * @returns The home page content.
 */
export const onHomePage: OnHomePageHandler = async () => {
  const state = await getState(snap as unknown as SnapProvider);
  return { content: renderHomePage(state?.watches?.length ?? 0) };
};

/**
 * `onCronjob` — every 10 minutes (see the manifest) check watched merchants for new payments.
 *
 * @param args - The cron request.
 * @param args.request - The job's JSON-RPC request.
 * @returns `null` when the check ran.
 * @throws {MethodNotFoundError} for an unknown job.
 */
export const onCronjob: OnCronjobHandler = async ({ request }) => {
  if (request.method !== 'checkPayments') {
    throw new MethodNotFoundError(`Method not found: ${request.method}`) as unknown as Error;
  }
  await checkPayments(snap as unknown as SnapProvider, ethereum as unknown as EthProvider);
  return null;
};
