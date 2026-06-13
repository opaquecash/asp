import { describe, it, expect, beforeAll } from "vitest";
import { buildPoolCrypto, PoolMerkleTree, type PoolCrypto } from "@opaquecash/privacy-pool";
import { AssociationSet } from "../src/set.js";

let crypto: PoolCrypto;
beforeAll(async () => {
  crypto = await buildPoolCrypto();
});

describe("AssociationSet", () => {
  it("orders labels by leafIndex regardless of insertion order, and dedups", () => {
    const set = new AssociationSet();
    expect(set.add({ label: 30n, leafIndex: 3 })).toBe(true);
    expect(set.add({ label: 10n, leafIndex: 1 })).toBe(true);
    expect(set.add({ label: 20n, leafIndex: 2 })).toBe(true);
    expect(set.add({ label: 99n, leafIndex: 1 })).toBe(false); // duplicate leafIndex

    expect(set.labels()).toEqual([10n, 20n, 30n]);
    expect(set.indexOf(2)).toBe(1);
    expect(set.size()).toBe(3);
  });

  it("computes the same root a withdrawer would, and a consistent inclusion proof", () => {
    const entries = [
      { label: 111n, leafIndex: 0 },
      { label: 222n, leafIndex: 1 },
      { label: 333n, leafIndex: 2 },
    ];
    const set = new AssociationSet(entries);

    // The set's root must equal an independently-built PoolMerkleTree over the same leaves —
    // this is exactly what a withdrawer reconstructs from the published `labels`.
    const labels = set.labels();
    const tree = new PoolMerkleTree(crypto, labels);
    expect(set.root(crypto)).toBe(tree.root());

    // A withdrawer at leafIndex 1 finds aspIndex 1 and a proof whose path is well-formed.
    const aspIndex = set.indexOf(1);
    expect(aspIndex).toBe(1);
    const proof = tree.proof(aspIndex);
    expect(proof.siblings).toHaveLength(20);
    expect(proof.pathIndices).toHaveLength(20);
  });

  it("an empty set's root is the all-zero-leaf tree root (zeros[levels])", () => {
    const set = new AssociationSet();
    expect(set.root(crypto)).toBe(crypto.zeros[20]);
  });

  it("round-trips through JSON", () => {
    const set = new AssociationSet([
      { label: 5n, leafIndex: 0 },
      { label: 7n, leafIndex: 4 },
    ]);
    const back = AssociationSet.fromJson(set.toJson());
    expect(back.labels()).toEqual([5n, 7n]);
    expect(back.root(crypto)).toBe(set.root(crypto));
  });
});
