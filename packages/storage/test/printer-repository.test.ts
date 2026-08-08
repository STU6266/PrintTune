import { InMemoryPrinterRepository } from "../src/index";
import { describePrinterRepository } from "./printer-repository-contract";

describePrinterRepository("InMemoryPrinterRepository", () => ({
  repository: new InMemoryPrinterRepository(),
  close() {},
}));
