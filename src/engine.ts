/**
 * The chain-agnostic ASP engine: one tick per pool.
 *
 * Each tick *reconciles* rather than merely appending, so it is idempotent and self-healing:
 *
 *   1. Re-screen deferred deposits from prior ticks.
 *   2. Read newly-finalized deposits after the stored cursor; screen each.
 *   3. Rebuild the association tree and compare its root to the on-chain root.
 *   4. If they differ (and the set is non-empty): publish the opening, THEN post the root.
 *   5. Persist cursor + set + pending only after the on-chain post is confirmed.
 *
 * If a previous tick crashed after publishing but before posting (or after posting but before
 * persisting), the next tick re-detects the root mismatch and re-posts — posting the same root
 * is a harmless no-op on-chain. Approved labels are ordered by leafIndex (see set.ts).
 */

import { buildPoolCrypto, POOL_LEVELS, type PoolCrypto } from "@opaquecash/privacy-pool";
import { AssociationSet } from "./set.js";
import { publishSet, type Pinner, type PublishInput } from "./publish.js";
import type { PoolState, StoreLike } from "./store.js";
import type { ChainAdapter, Policy } from "./types.js";

export interface EngineDeps {
  store: StoreLike;
  crypto: PoolCrypto;
  policy: Policy;
  /** IPFS pinner for published openings. */
  pinner: Pinner;
  /** Where manifests are written. */
  dataDir: string;
  /** Merkle depth (must match the pool / circuit). */
  levels?: number;
  log?: (msg: string) => void;
  /** Override the publish step (tests inject a stub). Defaults to {@link publishSet}. */
  publish?: (input: PublishInput) => Promise<{ cid: string | null }>;
}

export interface TickResult {
  poolId: string;
  scanned: number;
  approved: number;
  rejected: number;
  deferred: number;
  setSize: number;
  rootChanged: boolean;
  posted: boolean;
  root: string;
  cid: string | null;
  txId?: string;
  error?: string;
}

/** Build the shared crypto once and reuse it across ticks (loads a wasm). */
export async function buildEngineCrypto(): Promise<PoolCrypto> {
  return buildPoolCrypto();
}

export async function runPoolTick(adapter: ChainAdapter, deps: EngineDeps): Promise<TickResult> {
  const levels = deps.levels ?? POOL_LEVELS;
  const log = deps.log ?? (() => {});
  const publish = deps.publish ?? ((input: PublishInput) => publishSet(input));

  const state = deps.store.load(adapter.poolId);
  const set = AssociationSet.fromJson(state.entries);

  let approved = 0;
  let rejected = 0;
  let deferred = 0;

  // 1. Re-screen previously deferred deposits.
  const stillPending: PoolState["pending"] = [];
  for (const p of state.pending) {
    if (set.has(p.leafIndex)) continue;
    const verdict = await deps.policy.screen({
      label: BigInt(p.label),
      leafIndex: p.leafIndex,
      cursor: p.cursor,
    });
    if (verdict === "approve") {
      set.add({ label: BigInt(p.label), leafIndex: p.leafIndex });
      approved++;
    } else if (verdict === "defer") {
      stillPending.push(p);
      deferred++;
    } else {
      rejected++;
    }
  }

  // 2. Read + screen newly-finalized deposits.
  const { deposits, cursor } = await adapter.readDeposits(state.cursor);
  for (const d of deposits) {
    if (set.has(d.leafIndex)) continue;
    const verdict = await deps.policy.screen(d);
    if (verdict === "approve") {
      set.add({ label: d.label, leafIndex: d.leafIndex });
      approved++;
    } else if (verdict === "defer") {
      stillPending.push({ label: d.label.toString(), leafIndex: d.leafIndex, cursor: d.cursor });
      deferred++;
    } else {
      rejected++;
    }
  }

  // 3. Reconcile the root.
  const computed = set.root(deps.crypto);
  const onchain = await adapter.currentAspRoot();
  let rootChanged = false;
  let posted = false;
  let txId: string | undefined;
  let cid: string | null = state.published?.cid ?? null;

  if (set.size() > 0 && computed !== onchain) {
    rootChanged = true;
    const version = (state.published?.version ?? 0) + 1;

    // 4a. Publish the opening FIRST so the root is never ahead of its fetchable list.
    const pub = await publish({
      poolId: adapter.poolId,
      root: computed,
      version,
      labels: set.labels(),
      levels,
      dataDir: deps.dataDir,
      pinner: deps.pinner,
    });
    cid = pub.cid;
    log(`[${adapter.poolId}] published set v${version} root=${computed} cid=${cid ?? "none"}`);

    // 4b. Post the root on-chain.
    txId = await adapter.postAspRoot(computed);
    posted = true;
    log(`[${adapter.poolId}] posted aspRoot tx=${txId}`);

    state.published = { root: computed.toString(), cid, version, at: new Date().toISOString() };
  }

  // 5. Persist (only now that the post is confirmed).
  state.cursor = cursor;
  state.entries = set.toJson();
  state.pending = stillPending;
  deps.store.save(state);

  return {
    poolId: adapter.poolId,
    scanned: deposits.length,
    approved,
    rejected,
    deferred,
    setSize: set.size(),
    rootChanged,
    posted,
    root: computed.toString(),
    cid,
    txId,
  };
}
