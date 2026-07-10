import { describe, it, expect, beforeAll } from "vitest";
import { buildPoolCrypto, type PoolCrypto } from "@opaquecash/privacy-pool";
import { assertValidDeposits } from "../src/validate.js";
import type { Deposit } from "../src/types.js";

let crypto: PoolCrypto;
beforeAll(async () => {
  crypto = await buildPoolCrypto();
});

const SCOPE = 123456789n;

/** A deposit carrying the on-chain-guaranteed label for its leafIndex. */
function honest(leafIndex: number): Deposit {
  return { leafIndex, label: crypto.label(SCOPE, BigInt(leafIndex)), cursor: String(leafIndex) };
}

describe("assertValidDeposits (OPQ-009)", () => {
  it("accepts a monotonic batch whose labels are Poseidon(scope, leafIndex)", () => {
    expect(() => assertValidDeposits(crypto, SCOPE, [honest(0), honest(1), honest(2)], "evm:test")).not.toThrow();
    expect(() => assertValidDeposits(crypto, SCOPE, [], "evm:test")).not.toThrow(); // empty is trivially valid
  });

  it("rejects a fabricated label the RPC could inject", () => {
    const forged: Deposit = { leafIndex: 1, label: 999n, cursor: "1" };
    expect(() => assertValidDeposits(crypto, SCOPE, [honest(0), forged], "evm:test")).toThrow(/refusing to trust/i);
  });

  it("rejects a label computed under the wrong scope", () => {
    const wrongScope: Deposit = { leafIndex: 0, label: crypto.label(SCOPE + 1n, 0n), cursor: "0" };
    expect(() => assertValidDeposits(crypto, SCOPE, [wrongScope], "evm:test")).toThrow(/Poseidon/);
  });

  it("rejects reordered or duplicated leafIndices", () => {
    expect(() => assertValidDeposits(crypto, SCOPE, [honest(1), honest(0)], "evm:test")).toThrow(/non-monotonic/i);
    expect(() => assertValidDeposits(crypto, SCOPE, [honest(0), honest(0)], "evm:test")).toThrow(/non-monotonic/i);
  });
});
