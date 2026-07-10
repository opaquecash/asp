/**
 * Deposit integrity validation at the RPC trust boundary (spec/privacy-pool.md §1).
 *
 * The on-chain pool assigns every deposit `label = Poseidon(scope, leafIndex)`, where `scope`
 * is a pool-binding constant readable from chain. The label is therefore fully determined by
 * public data — the ASP never has to trust the `label`/`leafIndex` an RPC reports. A malicious
 * or compromised RPC that fabricates labels, mislabels a deposit, or reorders/duplicates
 * leafIndices would otherwise flow straight into the association-set root the ASP signs and
 * posts on-chain, breaking honest withdrawers' reconstruction pool-wide (OPQ-009). Adapters
 * run this over every batch they read so a mismatch aborts the tick instead of poisoning the
 * root; the indexer alarms and retries, and nothing is persisted.
 */

import type { PoolCrypto } from "@opaquecash/privacy-pool";
import type { Deposit } from "./types.js";

/**
 * Assert each deposit's `label` equals `Poseidon(scope, leafIndex)` and that leafIndices are
 * strictly ascending within the batch. Throws on the first violation.
 */
export function assertValidDeposits(
  crypto: PoolCrypto,
  scope: bigint,
  deposits: Deposit[],
  poolId: string,
): void {
  let last = -1;
  for (const d of deposits) {
    const expected = crypto.label(scope, BigInt(d.leafIndex));
    if (d.label !== expected) {
      throw new Error(
        `[${poolId}] deposit at leafIndex ${d.leafIndex} reports label ${d.label}, but the pool ` +
          `guarantees Poseidon(scope, leafIndex) = ${expected}; refusing to trust the RPC (OPQ-009)`,
      );
    }
    if (d.leafIndex <= last) {
      throw new Error(
        `[${poolId}] non-monotonic deposit leafIndex ${d.leafIndex} after ${last} — reordered or ` +
          `duplicated by the RPC (OPQ-009)`,
      );
    }
    last = d.leafIndex;
  }
}
