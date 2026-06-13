/**
 * The canonical association set for one pool: the ordered list of approved deposit
 * `label`s that defines the association tree (spec/privacy-pool.md §2).
 *
 * Ordering is by ascending `leafIndex` (the deposit's state-tree position). This is
 * deterministic and reproducible by anyone, so a withdrawer who knows their own
 * `leafIndex` can locate their label's position (`aspIndex`) in the published list and
 * rebuild the exact tree the ASP committed to. The tree itself is built with the SDK's
 * `PoolMerkleTree`, byte-identical to the withdrawal circuit and the on-chain pool.
 */

import { PoolMerkleTree, type PoolCrypto } from "@opaquecash/privacy-pool";

/** One approved deposit in the set. */
export interface SetEntry {
  label: bigint;
  leafIndex: number;
}

/** Serializable form (bigints as decimal strings) for the durable store / manifests. */
export interface SetEntryJson {
  label: string;
  leafIndex: number;
}

export class AssociationSet {
  /** Kept sorted by leafIndex, unique on leafIndex. */
  private entries: SetEntry[];

  constructor(entries: SetEntry[] = []) {
    this.entries = [];
    for (const e of entries) this.add(e);
  }

  /** True if a deposit with this leafIndex is already in the set. */
  has(leafIndex: number): boolean {
    return this.entries.some((e) => e.leafIndex === leafIndex);
  }

  /** Add an approved entry in canonical (leafIndex-ascending) order. Returns false if a duplicate. */
  add(entry: SetEntry): boolean {
    if (this.has(entry.leafIndex)) return false;
    // Insert keeping the array sorted by leafIndex.
    let i = this.entries.length;
    while (i > 0 && this.entries[i - 1]!.leafIndex > entry.leafIndex) i--;
    this.entries.splice(i, 0, { label: entry.label, leafIndex: entry.leafIndex });
    return true;
  }

  size(): number {
    return this.entries.length;
  }

  /** The ordered labels — the association tree's leaves. */
  labels(): bigint[] {
    return this.entries.map((e) => e.label);
  }

  /** The position of a deposit's label in the ordered list (a withdrawer's `aspIndex`), or -1. */
  indexOf(leafIndex: number): number {
    return this.entries.findIndex((e) => e.leafIndex === leafIndex);
  }

  /** The association-set root as a field element (empty set -> the all-zero-leaf tree root). */
  root(crypto: PoolCrypto): bigint {
    return new PoolMerkleTree(crypto, this.labels()).root();
  }

  toJson(): SetEntryJson[] {
    return this.entries.map((e) => ({ label: e.label.toString(), leafIndex: e.leafIndex }));
  }

  static fromJson(json: SetEntryJson[]): AssociationSet {
    return new AssociationSet(json.map((e) => ({ label: BigInt(e.label), leafIndex: e.leafIndex })));
  }
}
