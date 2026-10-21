/**
 * Read a token's symbol and decimals for the permit panel. Done only when the wallet is on the permit's own network
 * (the provider answers for the wallet's network); otherwise returns null and the panel shows raw units.
 */

import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem/utils';

import { sanitizeText } from '../branding/sanitize';
import type { EthProvider } from '../router/merchant';
import type { TokenMeta } from '../ui/permit2Panel';

const ERC20_ABI = parseAbi(['function symbol() view returns (string)', 'function decimals() view returns (uint8)']);

/**
 * @param token - The token address.
 * @param chainId - The chain the permit is for.
 * @param provider - The wallet's EIP-1193 provider.
 * @returns Symbol and decimals, or null when they cannot be read on that chain.
 */
export async function fetchTokenMeta(token: `0x${string}`, chainId: number, provider: EthProvider): Promise<TokenMeta | null> {
  try {
    if (Number((await provider.request({ method: 'eth_chainId' })) as string) !== chainId) {
      return null;
    }
    const call = async (functionName: 'symbol' | 'decimals'): Promise<unknown> => {
      const data = encodeFunctionData({ abi: ERC20_ABI, functionName });
      const raw = (await provider.request({ method: 'eth_call', params: [{ to: token, data }, 'latest'] })) as `0x${string}`;
      return decodeFunctionResult({ abi: ERC20_ABI, functionName, data: raw });
    };
    const symbol = sanitizeText(await call('symbol'), 12);
    const decimals = Number(await call('decimals'));
    return symbol.length > 0 && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? { symbol, decimals } : null;
  } catch {
    return null;
  }
}
