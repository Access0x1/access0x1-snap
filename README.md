# Access0x1 MetaMask Snap — readable payment insight

**Know what you're paying before you sign.** This [MetaMask Snap](https://docs.metamask.io/snaps/)
renders a human-readable insight panel for the `Access0x1Router` contract (the same address, `0xe92244e3368561faf21648146511DeDE3a475EB5`, on Base, Ethereum, Unichain and Arc) payments
inside the wallet's transaction-confirmation flow. Instead of blind calldata, a customer paying for a
booking sees **"Pay $29.00 to merchant #7"** — merchant name, the fee and what the business receives —
before they approve. It works on the four mainnets Access0x1 is live on: **Ethereum (1), Base (8453),
Unichain (130) and Arc (5042)**, where the router is known without any setup.

It is the wallet-side complement to the clear-signing descriptors:
clear-signing makes the transaction readable on a hardware wallet; this Snap makes it readable inside
MetaMask itself, and adds dapp-invokable read methods (config, payment history, last receipt).

```
MetaMask tx confirmation ─▶ onTransaction ─▶ payNative / payToken / swapAndPay (+Permit2, +native) insight
MetaMask signature       ─▶ onSignature   ─▶ Permit2 permit to the router: token, most it can spend, expiry
MetaMask address lookup  ─▶ onNameLookup  ─▶ merchant name (checked against the on-chain nameHash), ENS reverse
Snaps menu               ─▶ onHomePage    ─▶ what it does, the networks, how fees work
every 10 minutes         ─▶ onCronjob     ─▶ new PaymentReceived for watched merchants ─▶ snap_notify
dapp                     ─▶ onRpcRequest  ─▶ configure / setMerchantBranding / getRouterConfig /
                                             getPaymentHistory / getLastPaymentReceipt /
                                             watchMerchant / unwatchMerchant / getWatches
```

## What it shows

- **Transaction insight.** Merchant, amount, token, the fee from the router's `feeRuleOf(merchantId, caller)`
  with its minimum, and what the merchant receives. For pay-with-any-token calls it also shows what you pay
  with and that the swap happens in the same transaction.
- **Signature insight (0.3.0).** For a Permit2 `PermitTransferFrom` whose spender is the Access0x1 router:
  which token, the most it can spend, that only the router can use it and only once, and when it expires.
  A permit to any other spender, or any other signature, shows nothing.
- **Name lookup (0.3.0).** For an address on the four mainnets, the Access0x1 merchant behind it (a readable
  name is shown only if it hashes to the merchant's on-chain `nameHash`, otherwise `Merchant #id`) and, on
  Ethereum, the ENS reverse name (shown only if the name resolves back to the same address and is plain
  ASCII). **Reverse lookup only:** a domain input returns nothing, because MetaMask already resolves ENS names
  and a second resolver here would only add a place for a wrong address to appear in a send flow.
- **Home page (0.3.0).** What the Snap does, the four networks, and how fees work: one rule per payment
  (the merchant's own, else its app group's, else the default), and the business is paid in the same
  transaction.
- **Payment notifications (0.3.0).** A dapp calls `watchMerchant({ merchantId, chainId })`; the user confirms
  in a dialog; every 10 minutes the Snap asks the router for new `PaymentReceived` events for that id and
  raises a MetaMask notification for each. The wallet answers only for the network it is on, so a watch on
  another network waits, keeping its place, until the wallet is on that network again. Checks run while
  MetaMask is open.

## Doctrine

- **No keys, no funds.** The Snap is read and display only; it never holds or moves value, and signs nothing.
- **Router address.** On the four mainnets the router is `0xe92244e3368561faf21648146511DeDE3a475EB5`
  by default. A dapp can override it per chain with `configure`; the choice is kept in encrypted Snap state.
- Merchant branding (name, color, logo SVG) is fetched and **sanitized** before render
  (`src/branding/sanitize.ts`), so untrusted merchant metadata can't inject markup into the wallet UI.

## Layout

| Path | What it is |
|------|------------|
| `src/index.ts` | Entry point: the handlers `onTransaction`, `onSignature`, `onNameLookup`, `onHomePage`, `onCronjob`, `onRpcRequest`. |
| `src/router/` | Decode a router call, resolve the merchant and the fee rule, chains and the default router. |
| `src/signature/` | Recognise a Permit2 permit to the router; read the token's symbol and decimals. |
| `src/names/` | Merchants behind an address (registration logs, re-checked on-chain) and ENS reverse resolution. |
| `src/watch/` | Opt-in watches and the 10-minute payment check. |
| `src/branding/` | Fetch, sanitize, and store per-merchant branding. |
| `src/ui/`, `src/payout/` | Panels (insight, permit, home, watch confirmation, branding) and private-payout helpers. |
| `src/state.ts`, `src/types.ts` | Encrypted Snap state + shared types. |
| `snap.manifest.json` | Snap manifest (permissions, source shasum). |
| `SUBMISSION.md` | Answers for the MetaMask Snaps Directory, the permission list, the publish steps. |

## Develop

```bash
cd snap
npm install
npm run typecheck   # tsc --noEmit
npm run test        # vitest run
npm run build       # mm-snap build  → dist/bundle.js, and the real shasum into snap.manifest.json
npm run serve       # mm-snap serve  → local Snap for MetaMask Flask
```

Requires [MetaMask Flask](https://docs.metamask.io/snaps/get-started/install-flask/) to install the
local build. The permissions requested, and why each is needed, are listed in [`SUBMISSION.md`](SUBMISSION.md).

## Status

Version 0.3.0 is prepared for the MetaMask Snaps Directory (see `SUBMISSION.md`); it is not yet published.
The package id is `@access0x1/snap`. The Ethereum, Base and Unichain routers were read on-chain for this
release; test on-device with `npm run serve` against MetaMask Flask.
