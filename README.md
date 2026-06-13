# Opaque ASP — Association Set Provider

The **Association Set Provider** curates the privacy pool's "clean" association set and
publishes its Merkle root on-chain. It is the component that makes Opaque's privacy pool a
[Privacy Pools](https://arxiv.org/abs/2405.17435)-style compliant pool rather than a mixer:
withdrawals require a zero-knowledge proof of **both** state-tree membership **and**
association-set membership, so honest users cryptographically dissociate from illicit
deposits without revealing which deposit is theirs. See
[`spec/privacy-pool.md`](https://github.com/opaquecash) for the full construction.

This service implements the off-chain half of that loop for the deployed pools on **Ethereum
Sepolia** and **Solana devnet**.

## What it does

Each tick, per pool:

1. **Reads** newly-finalized `Deposit` events (each carries a `label = Poseidon(scope, leafIndex)`).
2. **Screens** every deposit through a pluggable [`Policy`](src/policy.ts) (`approve | reject | defer`).
3. **Maintains** the canonical association set — approved labels ordered by `leafIndex`.
4. **Reconciles** the set's Merkle root against the on-chain root; if they differ, it
   **publishes the opening** (the ordered label list) and then **posts the new root**
   (`setAspRoot` on EVM, `set_asp_root` on Solana), signed by the pool's ASP authority key.

The tick is reconcile-not-append, so it is idempotent and self-healing: a crash mid-publish
heals on the next tick because the root mismatch is re-detected and re-posted.

## Trust model

The ASP is a **liveness + curation** trust point, never an integrity one. The published
label list is **self-authenticating**: a withdrawer recomputes the root from the list and
checks it equals the on-chain `aspRoot`, so a wrong list simply fails to produce a valid
proof. The ASP cannot steal funds or forge double-spends — it only controls *which* deposits
are eligible to withdraw. On testnet a single authority key posts the root; production must
decentralize this (see `spec/privacy-pool.md` §7). **Testnet only.**

## Architecture

```
src/
  types.ts      ChainAdapter / Policy / Deposit interfaces (the seams)
  set.ts        AssociationSet — ordered labels + PoolMerkleTree root (reuses @opaquecash/privacy-pool)
  policy.ts     curation seam: approveAll (v1) + allowlist starter
  store.ts      FileStore — durable per-pool state (cursor, set, pending, published)
  publish.ts    self-contained manifest + optional IPFS pin
  engine.ts     runPoolTick — read → screen → reconcile root → publish → post → persist
  chains/
    evm.ts      Sepolia: Deposit logs + setAspRoot (addresses from @opaquecash/deployments)
    solana.ts   devnet: DepositEvent logs + set_asp_root (bundled IDL)
scripts/
  indexer.ts    loop / --once entry point
```

Pool addresses come from `@opaquecash/deployments`, so a redeploy is a registry bump, not a
code change. No contract/program/circuit code is touched by this service.

## Run

```bash
npm install
cp .env.example .env      # fill in RPCs + the ASP authority key(s)

npm run indexer:once      # single pass over all selected pools
npm run indexer           # loop every ASP_INTERVAL_MS
```

Configuration (see [`.env.example`](.env.example)): `ASP_CHAINS`, `ASP_INTERVAL_MS`,
`SEPOLIA_RPC_URL`/`SEPOLIA_PRIVATE_KEY`, `SOLANA_RPC_URL`/`SOLANA_KEYPAIR`,
`ASP_EVM_CONFIRMATIONS` (reorg buffer), and optional `IPFS_API_URL` for pinning.

The signing key **must be the pool's ASP authority** (`aspAuthority` on EVM, `asp_authority`
on Solana). Without IPFS configured, manifests are still written under `data/sets/` — the CID
is simply absent, which is fine because the set self-authenticates against the on-chain root.

## How a withdrawer uses the published set

The opening for each root is written to `data/sets/<poolId>/<root>.json` (and `latest.json`),
and pinned to IPFS when configured:

```json
{ "poolId": "evm:11155111", "root": "…", "version": 3, "levels": 20,
  "labels": ["…", "…"], "algo": "poseidon-bn254", "generatedAt": "…" }
```

A withdrawer fetches it, finds their `label`'s position in `labels` (their `aspIndex`), and
passes `aspLeaves: labels` + `aspIndex` into `@opaquecash/privacy-pool`'s
`buildWithdrawalWitness`. The resulting proof only verifies if the rebuilt tree hashes to the
on-chain `aspRoot` — which is exactly the self-authentication guarantee.

## Development

```bash
npm run typecheck
npm test            # vitest — pure logic (set/tree, store, policy, engine reconcile)
```

CI (`.github/workflows/asp-checks.yml`) runs typecheck + tests on Node 22. The indexer itself
is never run in CI: it posts transactions from a funded key against live testnets.

## License

[AGPL-3.0](LICENSE).
