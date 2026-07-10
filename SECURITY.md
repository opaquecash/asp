# ASP operational security

The ASP is a **liveness + curation** trust point, never an integrity one: withdrawals stay
proof-bound and value-conserving regardless of the ASP, and every published set is
self-authenticating (a withdrawer's proof only verifies if their reconstructed tree hashes to
the on-chain root). What the ASP authority *can* do is censor or mis-curate which deposits are
withdrawable, and — if it shares a key with the ENS discovery pointer — hijack that pointer.

## Key custody (OPQ-035)

The root-publishing authority is a hot key held by the long-running indexer. Harden it:

- **Separate duties.** Use a dedicated, minimally-funded key for the ENS discovery pointer,
  distinct from the ASP root-publishing authority. Set `ASP_ENS_PRIVATE_KEY` (it falls back to
  `SEPOLIA_PRIVATE_KEY` only for backward compatibility). Do **not** reuse the ASP authority
  key as the contract deployer or the relayer key either (see INFRA-1).
- **KMS/HSM.** Source the signing key from a KMS/HSM rather than a plaintext `.env`; keep
  `.env` gitignored (it is) and out of CI logs.
- **Rotation.** Rotate on any suspicion via the pool's `transferAspAuthority`; keep a runbook.
- **Threshold before mainnet.** Move the authority to a multisig/threshold signer before any
  mainnet deployment.

## Root integrity

The indexer never trusts an RPC's `(label, leafIndex)`: it recomputes `label =
Poseidon(scope, leafIndex)` from the on-chain `scope` and rejects mismatches or non-monotonic
indices (`src/validate.ts`, OPQ-009), and it never advances its cursor past a deposit it could
not fetch/decode (OPQ-005). The root it posts is the one it independently computed from that
validated set — it never signs a root supplied by an untrusted source. Cross-checking the
scope/labels against a second RPC before posting is a recommended additional guard for mainnet.
