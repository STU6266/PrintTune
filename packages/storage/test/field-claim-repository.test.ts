import { describe, expect, it } from "vitest";

import { InMemoryFieldClaimRepository } from "../src/index";
import { claim, describeFieldClaimRepository } from "./field-claim-repository-contract";

describeFieldClaimRepository("InMemoryFieldClaimRepository", () => ({
  repository: new InMemoryFieldClaimRepository(),
  close() {},
}));

describe("InMemoryFieldClaimRepository target behavior", () => {
  it("does not validate parent existence", async () => {
    const repository = new InMemoryFieldClaimRepository();
    await expect(
      repository.create(
        claim("orphan", {
          target: { type: "printer_state", printerStateId: "state-does-not-exist" },
        })
      )
    ).resolves.toBeUndefined();
  });
});
