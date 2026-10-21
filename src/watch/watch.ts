/**
 * Payment notifications. A merchant opts in (through the `watchMerchant` RPC method) to watch its merchant id on one
 * chain; a cron job every 10 minutes asks the router for new `PaymentReceived` events and raises a MetaMask
 * notification for each. The wallet's provider answers only for the network the wallet is on, so a watch on another
 * network waits (its position is kept) until the wallet is on that network again.
 */

import { decodeEventLog, pad, toHex } from 'viem/utils';

import { PAYMENT_RECEIVED_ABI, PAYMENT_RECEIVED_TOPIC0 } from '../router/abi';
import { chainLabel, routerForChain } from '../router/chains';
import { decodeOrderIdLabel, formatUsd } from '../router/decode';
import type { EthProvider } from '../router/merchant';
import { getState, setState, type SnapProvider } from '../state';
import { truncateAddress } from '../ui/insightPanel';
import type { SnapConfigState, Watch } from '../types';

/** How many merchants one wallet may watch. */
export const MAX_WATCHES = 10;
/** The widest block span asked of the node in one check. */
export const MAX_BLOCK_SPAN = 5000n;
/** The most notifications raised in one check; the rest are summarised in one. */
export const MAX_NOTIFICATIONS = 5;

/** What one check did, for tests and for the caller. */
export type CheckResult = { notified: number; waiting: number; failed: number };

type RawLog = { topics: string[]; data: string; blockNumber: string };

/**
 * Read a watch request's params.
 * @param params - The untrusted RPC params.
 * @returns A merchant id and chain id, or null when either is missing or malformed.
 */
export function parseWatchParams(params: unknown): { merchantId: bigint; chainId: number } | null {
  const obj = params && typeof params === 'object' ? (params as Record<string, unknown>) : null;
  const rawId = obj?.merchantId;
  const rawChain = obj?.chainId;
  const idText = typeof rawId === 'number' ? String(rawId) : rawId;
  if (typeof idText !== 'string' || !/^\d{1,30}$/u.test(idText)) {
    return null;
  }
  if (typeof rawChain !== 'number' || !Number.isSafeInteger(rawChain) || rawChain <= 0) {
    return null;
  }
  return { merchantId: BigInt(idText), chainId: rawChain };
}

/**
 * The chain the wallet is on, or null if it cannot be read.
 * @param provider - EIP-1193 provider.
 * @returns The chain id, or null.
 */
export async function activeChainId(provider: EthProvider): Promise<number | null> {
  try {
    const value = Number((await provider.request({ method: 'eth_chainId' })) as string);
    return Number.isSafeInteger(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The current block number of the wallet's network.
 * @param provider - EIP-1193 provider.
 * @returns The block number.
 */
export async function currentBlock(provider: EthProvider): Promise<bigint> {
  return BigInt((await provider.request({ method: 'eth_blockNumber' })) as string);
}

/**
 * Add a watch (or leave an identical one as is). Returns the new state; the cap is {@link MAX_WATCHES}.
 * @param state - The current state.
 * @param watch - The watch to add.
 * @returns The state with the watch, or null if the cap is reached.
 */
export function withWatch(state: SnapConfigState, watch: Watch): SnapConfigState | null {
  const others = (state.watches ?? []).filter((w) => !(w.chainId === watch.chainId && w.merchantId === watch.merchantId));
  if (others.length >= MAX_WATCHES) {
    return null;
  }
  return { ...state, watches: [...others, watch] };
}

/**
 * Remove a watch.
 * @param state - The current state.
 * @param chainId - The watch's chain.
 * @param merchantId - The watch's merchant id, decimal.
 * @returns The state without it.
 */
export function withoutWatch(state: SnapConfigState, chainId: number, merchantId: string): SnapConfigState {
  return { ...state, watches: (state.watches ?? []).filter((w) => !(w.chainId === chainId && w.merchantId === merchantId)) };
}

/**
 * The notification text for one payment.
 * @param log - The raw log.
 * @param watch - The watch it matched.
 * @returns A plain-text message under the 500-character limit, or null if the log does not decode.
 */
export function paymentMessage(log: RawLog, watch: Watch): string | null {
  try {
    const event = decodeEventLog({
      abi: PAYMENT_RECEIVED_ABI,
      data: log.data as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    });
    const { buyer, usdAmount8, orderId } = event.args;
    return `Merchant #${watch.merchantId} on ${chainLabel(watch.chainId)} received ${formatUsd(usdAmount8)} from ${truncateAddress(buyer)}, order ${decodeOrderIdLabel(orderId).slice(0, 40)}.`;
  } catch {
    return null;
  }
}

/**
 * Send an in-app notification.
 * @param snap - The Snap runtime provider.
 * @param message - The text to show.
 */
async function notify(snap: SnapProvider, message: string): Promise<void> {
  await snap.request({ method: 'snap_notify', params: { type: 'inApp', message } });
}

/**
 * Check every watch the wallet's current network can answer for, and notify for new payments. A watch's position moves
 * forward only after its notifications went out, so a failure is retried on the next run rather than lost.
 * @param snap - The Snap runtime provider.
 * @param provider - The wallet's EIP-1193 provider.
 * @returns What was done.
 */
export async function checkPayments(snap: SnapProvider, provider: EthProvider): Promise<CheckResult> {
  const result: CheckResult = { notified: 0, waiting: 0, failed: 0 };
  const state = await getState(snap);
  if (!state?.watches?.length) {
    return result;
  }
  const active = await activeChainId(provider);
  const next: Watch[] = [];
  for (const watch of state.watches) {
    const router = routerForChain(state, watch.chainId);
    if (!router || active !== watch.chainId) {
      result.waiting += 1;
      next.push(watch);
      continue;
    }
    try {
      const latest = await currentBlock(provider);
      const from = BigInt(watch.lastBlock) + 1n;
      if (from > latest) {
        next.push(watch);
        continue;
      }
      const to = from + MAX_BLOCK_SPAN - 1n < latest ? from + MAX_BLOCK_SPAN - 1n : latest;
      const logs = (await provider.request({
        method: 'eth_getLogs',
        params: [
          {
            address: router,
            topics: [PAYMENT_RECEIVED_TOPIC0, pad(toHex(BigInt(watch.merchantId)), { size: 32 })],
            fromBlock: toHex(from),
            toBlock: toHex(to),
          },
        ],
      })) as RawLog[];
      const messages = logs.map((log) => paymentMessage(log, watch));
      result.failed += messages.filter((m) => m === null).length;
      const good = messages.filter((m): m is string => m !== null);
      for (const message of good.slice(0, MAX_NOTIFICATIONS)) {
        await notify(snap, message);
      }
      if (good.length > MAX_NOTIFICATIONS) {
        await notify(snap, `Merchant #${watch.merchantId} on ${chainLabel(watch.chainId)} received ${good.length - MAX_NOTIFICATIONS} more payments.`);
      }
      result.notified += good.length;
      next.push({ ...watch, lastBlock: to.toString() });
    } catch {
      result.failed += 1;
      next.push(watch);
    }
  }
  // Re-read before writing: an opt-in or opt-out that arrived during this run must not be overwritten.
  const fresh = (await getState(snap)) ?? state;
  const moved = new Map(next.map((w) => [`${w.chainId}:${w.merchantId}`, w]));
  const merged = (fresh.watches ?? []).map((w) => moved.get(`${w.chainId}:${w.merchantId}`) ?? w);
  await setState(snap, { ...fresh, watches: merged });
  return result;
}
