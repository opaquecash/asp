import { describe, it, expect, beforeAll } from "vitest";
import { buildPoolCrypto, type PoolCrypto } from "@opaquecash/privacy-pool";
import { runPoolTick, type EngineDeps } from "../src/engine.js";
import { approveAll, allowlistPolicy } from "../src/policy.js";
import { AssociationSet } from "../src/set.js";
import type { Deposit, Policy, Screen } from "../src/types.js";
import { FakeAdapter, MemoryStore, dep } from "./helpers.js";

let crypto: PoolCrypto;
beforeAll(async () => {
  crypto = await buildPoolCrypto();
});

/** A publish stub: records calls, returns no CID (no filesystem/network in tests). */
function stubPublish() {
  const calls: { root: bigint; version: number; labels: bigint[] }[] = [];
  return {
    calls,
    fn: async (input: { root: bigint; version: number; labels: bigint[] }) => {
      calls.push({ root: input.root, version: input.version, labels: input.labels });
      return { cid: null };
    },
  };
}

function deps(store: MemoryStore, policy: Policy, publish: EngineDeps["publish"]): EngineDeps {
  return { store, crypto, policy, pinner: { name: "test", pin: async () => null }, dataDir: "/tmp/unused", publish };
}

describe("runPoolTick", () => {
  it("approves deposits, posts a root, and publishes the opening before posting", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter("evm:test", [[dep(0), dep(1), dep(2)]]);
    const pub = stubPublish();

    const r = await runPoolTick(adapter, deps(store, approveAll, pub.fn));

    expect(r.approved).toBe(3);
    expect(r.setSize).toBe(3);
    expect(r.posted).toBe(true);
    expect(r.rootChanged).toBe(true);

    // Posted root equals the set's computed root.
    const expected = new AssociationSet([dep(0), dep(1), dep(2)]).root(crypto);
    expect(adapter.postedRoots).toEqual([expected]);
    expect(r.root).toBe(expected.toString());

    // The opening was published with the same root + ordered labels.
    expect(pub.calls).toHaveLength(1);
    expect(pub.calls[0]!.root).toBe(expected);
    expect(pub.calls[0]!.labels).toEqual([dep(0).label, dep(1).label, dep(2).label]);
  });

  it("is idempotent: a second tick with no new deposits posts nothing", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter("evm:test", [[dep(0), dep(1)], []]);
    const pub = stubPublish();

    await runPoolTick(adapter, deps(store, approveAll, pub.fn));
    const second = await runPoolTick(adapter, deps(store, approveAll, pub.fn));

    expect(second.posted).toBe(false);
    expect(second.rootChanged).toBe(false);
    expect(adapter.postedRoots).toHaveLength(1); // only the first tick posted
    expect(second.setSize).toBe(2); // set persisted across ticks
  });

  it("self-heals: if the on-chain root drifts, the next tick re-posts", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter("evm:test", [[dep(0)], []]);
    const pub = stubPublish();

    await runPoolTick(adapter, deps(store, approveAll, pub.fn));
    expect(adapter.postedRoots).toHaveLength(1);

    // Simulate a divergent on-chain root (e.g. a prior post that never landed).
    await adapter.postAspRoot(999999n);
    const heal = await runPoolTick(adapter, deps(store, approveAll, pub.fn));

    expect(heal.posted).toBe(true);
    expect(adapter.postedRoots[adapter.postedRoots.length - 1]).toBe(
      new AssociationSet([dep(0)]).root(crypto),
    );
  });

  it("rejects unapproved deposits and never adds them to the set", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter("evm:test", [[dep(0), dep(1)]]);
    const pub = stubPublish();
    // Allow only dep(0)'s label.
    const policy = allowlistPolicy([dep(0).label]);

    const r = await runPoolTick(adapter, deps(store, policy, pub.fn));

    expect(r.approved).toBe(1);
    expect(r.rejected).toBe(1);
    expect(r.setSize).toBe(1);
  });

  it("defers deposits and re-screens them on a later tick", async () => {
    const store = new MemoryStore();
    const adapter = new FakeAdapter("evm:test", [[dep(0)], []]);
    const pub = stubPublish();

    // First tick: defer everything. Second tick: approve everything.
    let approveNow = false;
    const flip: Policy = { name: "flip", screen: (): Screen => (approveNow ? "approve" : "defer") };

    const first = await runPoolTick(adapter, deps(store, flip, pub.fn));
    expect(first.deferred).toBe(1);
    expect(first.setSize).toBe(0);
    expect(first.posted).toBe(false);

    approveNow = true;
    const second = await runPoolTick(adapter, deps(store, flip, pub.fn));
    expect(second.approved).toBe(1); // the deferred deposit, re-screened
    expect(second.setSize).toBe(1);
    expect(second.posted).toBe(true);
  });
});
