/**
 * Publishing the association set's opening.
 *
 * The on-chain root commits to the set; this module publishes the *opening* — the ordered
 * label list a withdrawer needs to compute their `aspIndex` and rebuild the tree. The
 * manifest is self-contained (labels inline) and self-authenticating: a withdrawer recomputes
 * the root from `labels` and checks it equals the on-chain `aspRoot`, so they never have to
 * trust the ASP's list. IPFS pinning is therefore an *availability* aid, not a trust anchor —
 * if no pinner is configured the manifest is still written locally and `cid` is null.
 *
 * Ordering matters: the engine publishes the opening BEFORE posting the root on-chain, so a
 * withdrawer never sees a root whose opening is not yet fetchable.
 */

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A pinning backend. Returns the CID, or null if pinning is unavailable. */
export interface Pinner {
  readonly name: string;
  pin(bytes: Uint8Array): Promise<string | null>;
}

/** No pinning — manifests are written locally only. */
export const noopPinner: Pinner = {
  name: "none",
  async pin() {
    return null;
  },
};

/**
 * Pin via a Kubo-compatible IPFS HTTP API (`POST {apiUrl}/api/v0/add`). Works against a
 * local `ipfs daemon` or any Kubo gateway. Network/availability failures degrade to null
 * (the local manifest is the source of truth) rather than blocking a root update.
 */
export function kuboPinner(apiUrl: string, fetchFn: typeof fetch = fetch): Pinner {
  const base = apiUrl.replace(/\/$/, "");
  return {
    name: `kubo(${base})`,
    async pin(bytes: Uint8Array): Promise<string | null> {
      try {
        const form = new FormData();
        form.append("file", new Blob([bytes]), "association-set.json");
        const res = await fetchFn(`${base}/api/v0/add?cid-version=1&pin=true`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) return null;
        const json = (await res.json()) as { Hash?: string };
        return json.Hash ?? null;
      } catch {
        return null;
      }
    },
  };
}

/** Pick a pinner from the environment: `IPFS_API_URL` -> Kubo, else no-op. */
export function pinnerFromEnv(): Pinner {
  const url = process.env.IPFS_API_URL;
  return url ? kuboPinner(url) : noopPinner;
}

/** The published opening for one association-set root. */
export interface SetManifest {
  poolId: string;
  /** The association-set root this opening proves, as a decimal string. */
  root: string;
  /** Monotonic publish version. */
  version: number;
  /** Hashing parameters, so a withdrawer rebuilds the identical tree. */
  algo: "poseidon-bn254";
  levels: number;
  /** Ordered labels (decimal strings) — the tree leaves. A withdrawer's `aspIndex` is the
   * position of their label here. */
  labels: string[];
  generatedAt: string;
}

export interface PublishInput {
  poolId: string;
  root: bigint;
  version: number;
  labels: bigint[];
  levels: number;
  dataDir: string;
  pinner: Pinner;
}

export interface PublishResult {
  manifest: SetManifest;
  cid: string | null;
  manifestPath: string;
}

function safeName(poolId: string): string {
  return poolId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Write the manifest to `{dataDir}/sets/{poolId}/{root}.json` (+ a `latest.json` pointer)
 * and pin it. The per-root file is immutable history; `latest.json` is the current opening.
 */
export async function publishSet(input: PublishInput): Promise<PublishResult> {
  const manifest: SetManifest = {
    poolId: input.poolId,
    root: input.root.toString(),
    version: input.version,
    algo: "poseidon-bn254",
    levels: input.levels,
    labels: input.labels.map((l) => l.toString()),
    generatedAt: new Date().toISOString(),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  const dir = join(input.dataDir, "sets", safeName(input.poolId));
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${manifest.root}.json`);
  writeFileSync(path, bytes);

  // Atomic-ish latest pointer.
  const latest = join(dir, "latest.json");
  const latestTmp = `${latest}.tmp`;
  writeFileSync(latestTmp, bytes);
  renameSync(latestTmp, latest);

  const cid = await input.pinner.pin(bytes);
  return { manifest, cid, manifestPath: path };
}
