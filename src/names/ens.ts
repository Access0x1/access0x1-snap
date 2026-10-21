/**
 * ENS reverse resolution with forward verification: a name is returned only when the address's reverse record names
 * it AND that name resolves back to the same address. Mainnet registry only; no wildcard or off-chain lookups.
 */

import { namehash } from 'viem/ens';
import { decodeFunctionResult, encodeFunctionData, isAddressEqual, parseAbi } from 'viem/utils';

import type { EthProvider } from '../router/merchant';

/** The ENS registry, the same address on every network it is deployed to. */
export const ENS_REGISTRY = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

const ENS_ABI = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function name(bytes32 node) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
]);

const ZERO = '0x0000000000000000000000000000000000000000';

/** Plain ASCII names only: anything with look-alike characters is not shown. */
const SAFE_NAME = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}$/u;

/**
 * Call one read-only ENS function over `eth_call` and decode the result.
 * @param provider - EIP-1193 provider.
 * @param to - The contract to call.
 * @param functionName - Which ENS function to call.
 * @param node - The namehash the call is about.
 * @returns The decoded result.
 */
async function read(
  provider: EthProvider,
  to: `0x${string}`,
  functionName: 'resolver' | 'name' | 'addr',
  node: `0x${string}`,
): Promise<unknown> {
  const data = encodeFunctionData({ abi: ENS_ABI, functionName, args: [node] });
  const raw = (await provider.request({ method: 'eth_call', params: [{ to, data }, 'latest'] })) as `0x${string}`;
  return decodeFunctionResult({ abi: ENS_ABI, functionName, data: raw });
}

/**
 * Find the resolver registered for a name.
 * @param provider - EIP-1193 provider.
 * @param node - The namehash to look up.
 * @returns The resolver address, or null when none is set.
 */
async function resolverOf(provider: EthProvider, node: `0x${string}`): Promise<`0x${string}` | null> {
  const resolver = (await read(provider, ENS_REGISTRY, 'resolver', node)) as `0x${string}`;
  return isAddressEqual(resolver, ZERO) ? null : resolver;
}

/**
 * Reverse-resolve an address on Ethereum mainnet.
 * @param address - The address to name.
 * @param provider - A provider connected to Ethereum mainnet.
 * @returns The verified name, or null on any miss or failure.
 */
export async function reverseEns(address: `0x${string}`, provider: EthProvider): Promise<string | null> {
  try {
    const reverseNode = namehash(`${address.slice(2).toLowerCase()}.addr.reverse`);
    const reverseResolver = await resolverOf(provider, reverseNode);
    if (!reverseResolver) {
      return null;
    }
    const name = (await read(provider, reverseResolver, 'name', reverseNode)) as string;
    if (!SAFE_NAME.test(name)) {
      return null;
    }
    const forwardNode = namehash(name);
    const forwardResolver = await resolverOf(provider, forwardNode);
    if (!forwardResolver) {
      return null;
    }
    const resolved = (await read(provider, forwardResolver, 'addr', forwardNode)) as `0x${string}`;
    return isAddressEqual(resolved, address) ? name : null;
  } catch {
    return null;
  }
}
