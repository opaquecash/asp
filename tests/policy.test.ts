import { describe, it, expect } from "vitest";
import { approveAll, allowlistPolicy } from "../src/policy.js";
import { dep } from "./helpers.js";

describe("policies", () => {
  it("approveAll approves every deposit", async () => {
    expect(await approveAll.screen(dep(0))).toBe("approve");
    expect(await approveAll.screen(dep(42))).toBe("approve");
  });

  it("allowlistPolicy approves listed labels and rejects the rest", async () => {
    const policy = allowlistPolicy([dep(1).label, dep(3).label]);
    expect(await policy.screen(dep(1))).toBe("approve");
    expect(await policy.screen(dep(3))).toBe("approve");
    expect(await policy.screen(dep(2))).toBe("reject");
  });
});
