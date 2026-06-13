/**
 * Shared interfaces for the Association Set Provider.
 *
 * The ASP is the off-chain curator of the privacy pool's "clean" association set
 * (spec/privacy-pool.md §2). It watches each pool's `Deposit` events, decides which
 * deposit `label`s are clean, maintains an ordered association tree, and publishes the
 * tree root on-chain so withdrawers can prove association-set membership. The on-chain
 * root is the commitment; the published label list is its opening — and because a
 * withdrawer's proof only verifies if their reconstructed tree hashes to the on-chain
 * root, the published list is self-authenticating (the ASP is a liveness/curation trust
 * point, never an integrity one).
 */

/** A pool deposit observed on-chain, reduced to what the ASP curates. */
export interface Deposit {
  /** The association-set `label = Poseidon(scope, leafIndex)`, as a BN254 field element. */
  label: bigint;
  /** The deposit's sequential state-tree leaf index — the canonical ordering key. */
  leafIndex: number;
  /** The chain-specific position this deposit was observed at (block number / signature). */
  cursor: string;
}

/** A screening verdict for one deposit. */
export type Screen = "approve" | "reject" | "defer";

/**
 * The curation policy — the ASP's actual business logic, deliberately one swappable seam.
 * `approve` adds the label to the clean set, `reject` drops it permanently, `defer` keeps
 * it pending for re-screening on a later tick (e.g. awaiting manual review).
 */
export interface Policy {
  readonly name: string;
  screen(deposit: Deposit): Screen | Promise<Screen>;
}

/**
 * A chain binding for one pool: read finalized deposits, read the current on-chain root,
 * and post a new root. The engine is written against this interface so EVM and Solana
 * share one curation/tree/publish core.
 */
export interface ChainAdapter {
  /** Stable pool id, e.g. `evm:11155111` or `solana:devnet`. */
  readonly poolId: string;
  /** Human-readable label for logs. */
  readonly chainLabel: string;
  /**
   * Read newly-finalized deposits after `cursor` (exclusive). Adapters apply their own
   * finality buffer so only reorg-safe deposits are returned. Returns the advanced cursor.
   */
  readDeposits(cursor: string | null): Promise<{ deposits: Deposit[]; cursor: string | null }>;
  /** The association-set root currently stored on-chain, as a field element. */
  currentAspRoot(): Promise<bigint>;
  /** Post a new association-set root on-chain (signed by the ASP authority). Returns the tx id. */
  postAspRoot(root: bigint): Promise<string>;
}
