/**
 * Test doubles: an in-memory store and a programmable fake chain adapter, so engine tests
 * run with no filesystem or network. The fake records posted roots and lets a test feed
 * deposits in batches (simulating successive ticks).
 */

import type { StoreLike, PoolState } from "../src/store.js";
import type { ChainAdapter, Deposit } from "../src/types.js";

export class MemoryStore implements StoreLike {
  private states = new Map<string, PoolState>();

  load(poolId: string): PoolState {
    const s = this.states.get(poolId);
    if (s) return structuredClone(s);
    return { poolId, cursor: null, entries: [], pending: [] };
  }

  save(state: PoolState): void {
    this.states.set(state.poolId, structuredClone(state));
  }
}

export class FakeAdapter implements ChainAdapter {
  readonly poolId: string;
  readonly chainLabel = "fake";
  private root = 0n;
  /** Batches of deposits, one per readDeposits call. */
  private batches: Deposit[][];
  private call = 0;
  postedRoots: bigint[] = [];

  constructor(poolId: string, batches: Deposit[][]) {
    this.poolId = poolId;
    this.batches = batches;
  }

  async readDeposits(cursor: string | null): Promise<{ deposits: Deposit[]; cursor: string | null }> {
    const deposits = this.batches[this.call] ?? [];
    this.call++;
    return { deposits, cursor: deposits.length ? String(this.call) : cursor };
  }

  async currentAspRoot(): Promise<bigint> {
    return this.root;
  }

  async postAspRoot(root: bigint): Promise<string> {
    this.root = root;
    this.postedRoots.push(root);
    return `tx-${this.postedRoots.length}`;
  }
}

/** A deposit with a deterministic label derived from leafIndex (label need not be a real hash). */
export function dep(leafIndex: number, label?: bigint): Deposit {
  return { leafIndex, label: label ?? BigInt(1000 + leafIndex), cursor: String(leafIndex) };
}
