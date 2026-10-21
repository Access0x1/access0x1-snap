/**
 * Find the Access0x1 merchants behind an address, read from the router's own registration events and re-checked
 * against the router's current `merchants(id)` state. The router has no address-to-id index, so this is a log query.
 */

import { decodeFunctionResult, encodeFunctionData, isAddressEqual, pad, toEventSelector } from 'viem/utils';

import { MERCHANTS_ABI, MERCHANT_REGISTERED_ABI } from '../router/abi';
import type { EthProvider } from '../router/merchant';

const ZERO = '0x0000000000000000000000000000000000000000';
export const REGISTERED_TOPIC = toEventSelector(MERCHANT_REGISTERED_ABI[0]);

/** At most this many ids are returned, and at most this many registrations are scanned for a payout match. */
export const MAX_IDS = 3;
const MAX_SCAN = 500;

type Log = { topics: string[]; data: string };

/**
 * Read event logs from the router.
 * @param provider - EIP-1193 provider.
 * @param router - The router address.
 * @param topics - The topic filter.
 * @returns The matching logs.
 */
async function getLogs(provider: EthProvider, router: `0x${string}`, topics: (string | null)[]): Promise<Log[]> {
  const logs = (await provider.request({
    method: 'eth_getLogs',
    params: [{ address: router, topics, fromBlock: '0x0', toBlock: 'latest' }],
  })) as Log[];
  return Array.isArray(logs) ? logs : [];
}

/**
 * The ids registered with this address as owner, else (if none) as payout.
 * @param provider - EIP-1193 provider on the router's chain.
 * @param router - The router address.
 * @param address - The address being looked up.
 * @returns Candidate merchant ids, newest first, at most {@link MAX_IDS}; empty on any failure.
 */
export async function candidateMerchantIds(
  provider: EthProvider,
  router: `0x${string}`,
  address: `0x${string}`,
): Promise<bigint[]> {
  try {
    let logs = await getLogs(provider, router, [REGISTERED_TOPIC, null, pad(address, { size: 32 })]);
    if (logs.length === 0) {
      const all = (await getLogs(provider, router, [REGISTERED_TOPIC])).slice(-MAX_SCAN);
      const wanted = address.slice(2).toLowerCase();
      logs = all.filter((log) => log.data.slice(26, 66).toLowerCase() === wanted);
    }
    return logs
      .map((log) => BigInt(log.topics[1] ?? '0x0'))
      .reverse()
      .slice(0, MAX_IDS);
  } catch {
    return [];
  }
}

/**
 * Whether the router CURRENTLY lists this merchant as active with this address as owner or payout, and its nameHash.
 * @param provider - EIP-1193 provider on the router's chain.
 * @param router - The router address.
 * @param id - The merchant id.
 * @param address - The address being looked up.
 * @returns The nameHash when the merchant is active and the address matches, else null.
 */
export async function activeMerchantNameHash(
  provider: EthProvider,
  router: `0x${string}`,
  id: bigint,
  address: `0x${string}`,
): Promise<`0x${string}` | null> {
  try {
    const data = encodeFunctionData({ abi: MERCHANTS_ABI, functionName: 'merchants', args: [id] });
    const raw = (await provider.request({ method: 'eth_call', params: [{ to: router, data }, 'latest'] })) as `0x${string}`;
    const [payout, owner, , , active, nameHash] = decodeFunctionResult({ abi: MERCHANTS_ABI, functionName: 'merchants', data: raw });
    if (!active || isAddressEqual(owner, ZERO)) {
      return null;
    }
    return isAddressEqual(owner, address) || isAddressEqual(payout, address) ? nameHash : null;
  } catch {
    return null;
  }
}
