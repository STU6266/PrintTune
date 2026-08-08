import type { Printer } from "@printtune/contracts";

export interface PrinterRepository {
  save(printer: Printer): Promise<void>;
  findById(id: string): Promise<Printer | undefined>;
  listByWorkspaceId(workspaceId: string): Promise<Printer[]>;
  delete(id: string): Promise<boolean>;
}
