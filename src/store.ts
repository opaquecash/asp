/**
 * Durable per-pool state. Unlike the relayer (which is stateless and re-derives delivery
 * status from chain), the ASP must persist its canonical ordered set and scan cursor: the
 * association tree lives off-chain, so it is not fully recoverable from chain alone.
 *
 * v1 uses one JSON file per pool with atomic (tmp + rename) writes. The set is small on
 * testnet (depth-20 tree caps at ~1M leaves); SQLite is the upgrade path if it grows.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SetEntryJson } from "./set.js";

/** What was last published on-chain + where its opening lives. */
export interface PublishedRecord {
  /** The posted association-set root (decimal string). */
  root: string;
  /** IPFS CID of the published label list, or null if no pinner was configured. */
  cid: string | null;
  /** Monotonic version, incremented per successful publish. */
  version: number;
  /** ISO timestamp of the publish. */
  at: string;
}

/** Persisted state for one pool. */
export interface PoolState {
  poolId: string;
  /** Last chain cursor scanned (block number / signature), or null on a fresh pool. */
  cursor: string | null;
  /** The canonical approved set (ordered by leafIndex). */
  entries: SetEntryJson[];
  /** Deposits seen but deferred by policy; re-screened each tick. */
  pending: (SetEntryJson & { cursor: string })[];
  /** The most recent successful publish, if any. */
  published?: PublishedRecord;
}

/** The store surface the engine depends on (a file store in prod, in-memory in tests). */
export interface StoreLike {
  load(poolId: string): PoolState;
  save(state: PoolState): void;
}

function emptyState(poolId: string): PoolState {
  return { poolId, cursor: null, entries: [], pending: [] };
}

/** Replace characters that are unsafe in a filename (e.g. the `:` in `evm:11155111`). */
function safeName(poolId: string): string {
  return poolId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileStore implements StoreLike {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(poolId: string): string {
    return join(this.dir, `${safeName(poolId)}.json`);
  }

  load(poolId: string): PoolState {
    try {
      const raw = readFileSync(this.path(poolId), "utf-8");
      const parsed = JSON.parse(raw) as PoolState;
      // Tolerate older/partial files.
      return {
        poolId,
        cursor: parsed.cursor ?? null,
        entries: parsed.entries ?? [],
        pending: parsed.pending ?? [],
        published: parsed.published,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyState(poolId);
      throw err;
    }
  }

  save(state: PoolState): void {
    const path = this.path(state.poolId);
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, path);
  }
}
