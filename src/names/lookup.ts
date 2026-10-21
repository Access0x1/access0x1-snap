/**
 * Name lookup for addresses on the four mainnets: the Access0x1 merchants behind the address (a readable name only when
 * it matches the merchant's on-chain nameHash) and, on Ethereum, the ENS reverse name. Reverse lookup only: a domain
 * input returns null, because MetaMask already resolves ENS names itself and a second resolver here could only add a
 * place for a wrong address to appear in a send flow.
 */

import { isAddress } from 'viem/utils';

import { reverseEns } from './ens';
import { activeMerchantNameHash, candidateMerchantIds } from './merchants';
import { fetchBranding, nameMatchesHash, type ResolveDeps } from '../branding/resolve';
import { getBranding } from '../branding/store';
import { routerForChain } from '../router/chains';
import type { EthProvider } from '../router/merchant';
import type { SnapConfigState } from '../types';

export type NameResult = { protocol: string; resolvedDomain: string };

/** Dependencies, injected so the lookup is testable offline. */
export type NameLookupDeps = {
  provider: EthProvider;
  state: SnapConfigState | null;
  resolve: Omit<ResolveDeps, 'routerAddress' | 'provider'>;
};

/** The numeric chain id of a CAIP-2 `eip155:` id, or null. */
export function numericChain(caip2: string): number | null {
  const match = /^eip155:(\d{1,10})$/u.exec(caip2);
  return match ? Number(match[1]) : null;
}

/**
 * Look up the names for an address.
 * @param caip2 - The CAIP-2 chain id of the lookup.
 * @param address - The address to name.
 * @param deps - Provider, snap state and branding dependencies.
 * @returns Zero or more names; never throws.
 */
export async function lookupAddress(caip2: string, address: string, deps: NameLookupDeps): Promise<NameResult[]> {
  const chainId = numericChain(caip2);
  if (chainId === null || !isAddress(address, { strict: false })) {
    return [];
  }
  const router = routerForChain(deps.state, chainId);
  if (!router) {
    return [];
  }
  try {
    const active = (await deps.provider.request({ method: 'eth_chainId' })) as string;
    if (Number(active) !== chainId) {
      return [];
    }
  } catch {
    return [];
  }
  const target = address as `0x${string}`;
  const results: NameResult[] = [];
  for (const id of await candidateMerchantIds(deps.provider, router, target)) {
    const nameHash = await activeMerchantNameHash(deps.provider, router, id, target);
    if (!nameHash) {
      continue;
    }
    const branding =
      (await getBranding(deps.resolve.snap, id)) ??
      (await fetchBranding(id, { ...deps.resolve, provider: deps.provider, routerAddress: router }));
    const readable = branding && nameMatchesHash(branding.name, nameHash) ? branding.name : `Merchant #${id.toString()}`;
    results.push({ protocol: 'Access0x1 merchant', resolvedDomain: readable });
  }
  if (chainId === 1) {
    const ens = await reverseEns(target, deps.provider);
    if (ens) {
      results.push({ protocol: 'ENS', resolvedDomain: ens });
    }
  }
  return results;
}
