/**
 * Minimal ABI fragments and event constants the Snap embeds to decode
 * `Access0x1Router` calldata and receipts.
 *
 * The Snap cannot import Foundry artifacts at runtime, so these fragments are
 * copied from the contract source (`src/Access0x1Router.sol`). The selectors
 * and `PAYMENT_RECEIVED_TOPIC0` were computed at build time with `cast` /
 * `keccak256` against the deployed ABI — NEVER transcribed from memory.
 *
 * To regenerate after any signature change, run from the repo root:
 *   cast sig "payNative(uint256,uint256,bytes32)"
 *   cast sig "payToken(uint256,address,uint256,bytes32)"
 *   cast keccak "PaymentReceived(uint256,address,address,uint256,uint256,uint256,uint256,bytes32,uint64)"
 *   cast sig "merchants(uint256)"
 */

import { parseAbi, toFunctionSelector } from 'viem/utils';

/**
 * The two router entry points the insight panel decodes. The ENTIRE ABI is
 * deliberately just these two functions — keeping the bundle tree-shakeable
 * and the attack surface minimal.
 */
export const ROUTER_ABI = parseAbi([
  'function payNative(uint256 merchantId, uint256 usdAmount8, bytes32 orderId) payable',
  'function payToken(uint256 merchantId, address token, uint256 usdAmount8, bytes32 orderId)',
  'function swapAndPay(uint256 merchantId, address tokenIn, uint256 amountInMax, address settlementToken, uint256 usdAmount8, bytes32 orderId, bytes swapData, uint256 deadline)',
  'function swapAndPayWithPermit2(uint256 merchantId, address tokenIn, uint256 amountInMax, address settlementToken, uint256 usdAmount8, bytes32 orderId, bytes swapData, uint256 deadline, bytes permitData)',
  'function swapAndPayNative(uint256 merchantId, address settlementToken, uint256 usdAmount8, bytes32 orderId, bytes swapData, uint256 deadline) payable',
]);

/** The fee rule the router applies to a payment (merchant, app group, module class, then global), with its minimum. */
export const FEE_RULE_ABI = parseAbi([
  'function feeRuleOf(uint256 merchantId, address caller) view returns (uint16 bps, uint64 minUsd8, uint8 source)',
]);

/** Pay-with-any-token calls: the customer's token is swapped through Uniswap into the merchant's stablecoin in the same transaction. */
export const SWAP_AND_PAY_SELECTOR = toFunctionSelector(ROUTER_ABI[2]);
export const SWAP_AND_PAY_PERMIT2_SELECTOR = toFunctionSelector(ROUTER_ABI[3]);
export const SWAP_AND_PAY_NATIVE_SELECTOR = toFunctionSelector(ROUTER_ABI[4]);

/**
 * The `merchants(uint256)` public getter. The auto-generated getter returns the
 * struct's value-type fields in declaration order:
 * `(payout, owner, feeRecipient, feeBps, active, nameHash)`.
 */
export const MERCHANTS_ABI = parseAbi([
  'function merchants(uint256 id) view returns (address payout, address owner, address feeRecipient, uint16 feeBps, bool active, bytes32 nameHash)',
]);

/**
 * The `platformFeeBps()` public getter. The on-chain fee that settles on every
 * payment is `platformFeeBps + merchant.feeBps` (see `_splitFee` in
 * `Access0x1Router.sol`), so the insight panel must read BOTH — showing only the
 * merchant surcharge understates the fee and overstates the merchant's net.
 * The contract enforces `feeBps + platformFeeBps <= MAX_FEE_BPS` at registration,
 * so the sum never needs re-capping here.
 */
export const PLATFORM_FEE_ABI = parseAbi([
  'function platformFeeBps() view returns (uint16)',
]);

/**
 * 4-byte selector of `payNative(uint256,uint256,bytes32)`.
 * Checked with `cast sig` against the router source.
 */
export const PAY_NATIVE_SELECTOR = '0x8589fa0f' as const;

/**
 * 4-byte selector of `payToken(uint256,address,uint256,bytes32)`.
 * Checked with `cast sig` against the router source.
 */
export const PAY_TOKEN_SELECTOR = '0x004bef62' as const;

/**
 * `keccak256` topic0 of the `PaymentReceived` event.
 *
 * Signature:
 *   PaymentReceived(uint256,address,address,uint256,uint256,uint256,uint256,bytes32,uint64)
 *
 * Checked with `cast keccak "PaymentReceived(uint256,address,address,uint256,uint256,uint256,uint256,bytes32,uint64)"`.
 */
export const PAYMENT_RECEIVED_TOPIC0 =
  '0x0e7e4f9badfadd9437d5fe53bdba0ca985b1b3414cb35b09a4459416e1735eea' as const;

/**
 * The `PaymentReceived` event fragment, used to decode receipt logs.
 */
export const PAYMENT_RECEIVED_ABI = parseAbi([
  'event PaymentReceived(uint256 indexed merchantId, address indexed buyer, address indexed token, uint256 grossAmount, uint256 feeAmount, uint256 netAmount, uint256 usdAmount8, bytes32 orderId, uint64 srcChainSelector)',
]);

/** The merchant registration event; the owner is indexed, the payout is the first data word. */
export const MERCHANT_REGISTERED_ABI = parseAbi([
  'event MerchantRegistered(uint256 indexed id, address indexed owner, address payout, address feeRecipient, uint16 feeBps, bytes32 nameHash)',
]);
