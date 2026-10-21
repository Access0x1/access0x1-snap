/**
 * Recognise a Permit2 `PermitTransferFrom` signature request whose spender is the Access0x1 router.
 *
 * The signature-insight handler shows this only when every part matches: the typed-data domain is the canonical
 * Permit2 contract, the struct has exactly Permit2's field layout, and the spender is the router for that chain.
 * Anything else returns null, so the panel never appears for a permit to someone else.
 */

import { isAddressEqual } from 'viem/utils';

import { routerForChain } from '../router/chains';

/** The canonical Permit2 contract, the same address on every chain. */
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as const;

/** Permit2's own struct layout; a request that differs is not a real Permit2 permit. */
const PERMIT_FIELDS = [
  { name: 'permitted', type: 'TokenPermissions' },
  { name: 'spender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'deadline', type: 'uint256' },
];
const TOKEN_FIELDS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
];

/** What the user is being asked to sign. */
export type Permit2Insight = {
  chainId: number;
  token: `0x${string}`;
  amount: bigint;
  spender: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
};

/** The part of the `onSignature` payload this reads. */
export type SignatureLike = { signatureMethod: string; data: unknown };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function sameFields(value: unknown, expected: { name: string; type: string }[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    expected.every((field, i) => {
      const got = asRecord(value[i]);
      return got !== null && got.name === field.name && got.type === field.type;
    })
  );
}

/** A uint256 as typed-data carries it: a number, a decimal string or a 0x string. Null if it is anything else. */
function toUint(value: unknown): bigint | null {
  try {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return BigInt(value);
    }
    if (typeof value === 'string' && /^(?:0x[0-9a-f]+|\d+)$/iu.test(value)) {
      return BigInt(value);
    }
  } catch {
    return null;
  }
  return null;
}

function toAddress(value: unknown): `0x${string}` | null {
  return typeof value === 'string' && ADDRESS.test(value) ? (value as `0x${string}`) : null;
}

/**
 * Parse a signature request into a Permit2 insight, or null when it is not a Permit2 transfer permit to the router.
 * @param signature - The `onSignature` signature payload.
 * @param configured - The persisted router config (an app-configured router), or null.
 * @returns The insight, or null.
 */
export function parsePermit2Signature(
  signature: SignatureLike,
  configured: { routerAddress: `0x${string}`; chainIds: number[] } | null,
): Permit2Insight | null {
  if (signature.signatureMethod !== 'eth_signTypedData_v4' && signature.signatureMethod !== 'eth_signTypedData_v3') {
    return null;
  }
  const data = asRecord(signature.data);
  const domain = asRecord(data?.domain);
  const types = asRecord(data?.types);
  const message = asRecord(data?.message);
  const permitted = asRecord(message?.permitted);
  if (!data || !domain || !types || !message || !permitted) {
    return null;
  }
  if (data.primaryType !== 'PermitTransferFrom' || domain.name !== 'Permit2') {
    return null;
  }
  const verifying = toAddress(domain.verifyingContract);
  if (!verifying || !isAddressEqual(verifying, PERMIT2_ADDRESS)) {
    return null;
  }
  if (!sameFields(types.PermitTransferFrom, PERMIT_FIELDS) || !sameFields(types.TokenPermissions, TOKEN_FIELDS)) {
    return null;
  }
  const chain = toUint(domain.chainId);
  const token = toAddress(permitted.token);
  const amount = toUint(permitted.amount);
  const spender = toAddress(message.spender);
  const nonce = toUint(message.nonce);
  const deadline = toUint(message.deadline);
  if (chain === null || !token || amount === null || !spender || nonce === null || deadline === null) {
    return null;
  }
  const chainId = Number(chain);
  const router = routerForChain(configured, chainId);
  if (!router || !isAddressEqual(spender, router)) {
    return null;
  }
  return { chainId, token, amount, spender, nonce, deadline };
}
