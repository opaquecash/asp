import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { aspSetUri, createEnsPointer, ASP_SET_RECORD_KEY } from "../src/ens.js";

describe("ens pointer", () => {
  it("wraps a CID as an ipfs:// URI (idempotently)", () => {
    expect(aspSetUri("QmAbc")).toBe("ipfs://QmAbc");
    expect(aspSetUri("ipfs://QmAbc")).toBe("ipfs://QmAbc");
  });

  it("uses com.opaque.aspset as the default record key (matches the SDK reader)", () => {
    expect(ASP_SET_RECORD_KEY).toBe("com.opaque.aspset");
  });

  it("constructs without network and exposes its name/key/pool", () => {
    // A dummy RPC URL is fine: ethers does not connect until a call is made, and we make none.
    const ptr = createEnsPointer({
      name: "evm-asp.opqtest.eth",
      resolver: ethers.ZeroAddress,
      textKey: ASP_SET_RECORD_KEY,
      poolId: "evm:11155111",
      rpcUrl: "http://127.0.0.1:8545",
      privateKey: "0x" + "11".repeat(32),
    });
    expect(ptr.name).toBe("evm-asp.opqtest.eth");
    expect(ptr.textKey).toBe("com.opaque.aspset");
    expect(ptr.poolId).toBe("evm:11155111");
  });
});
