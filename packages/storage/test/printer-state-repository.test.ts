import { InMemoryPrinterStateRepository } from "../src/index";
import { describePrinterStateRepository } from "./printer-state-repository-contract";

describePrinterStateRepository("InMemoryPrinterStateRepository", () => ({
  repository: new InMemoryPrinterStateRepository(),
  close() {},
}));
