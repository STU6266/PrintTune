import { InMemoryWorkspaceRepository } from "../src/index";
import { describeWorkspaceRepository } from "./workspace-repository-contract";

describeWorkspaceRepository("InMemoryWorkspaceRepository", () => {
  return {
    repository: new InMemoryWorkspaceRepository(),
    close() {},
  };
});
