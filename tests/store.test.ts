import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileStore, type PoolState } from "../src/store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "asp-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("FileStore", () => {
  it("returns empty state for an unknown pool", () => {
    const store = new FileStore(dir);
    const s = store.load("evm:11155111");
    expect(s).toEqual({ poolId: "evm:11155111", cursor: null, entries: [], pending: [] });
  });

  it("persists and reloads state across instances (sanitizing the filename)", () => {
    const a = new FileStore(dir);
    const state: PoolState = {
      poolId: "solana:devnet",
      cursor: "sig123",
      entries: [{ label: "42", leafIndex: 0 }],
      pending: [{ label: "7", leafIndex: 1, cursor: "sig9" }],
      published: { root: "555", cid: null, version: 2, at: "2026-06-14T00:00:00.000Z" },
    };
    a.save(state);

    const b = new FileStore(dir);
    expect(b.load("solana:devnet")).toEqual(state);
  });
});
