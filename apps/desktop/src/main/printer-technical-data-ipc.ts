import type { IpcMain, WebContents } from "electron";

import {
  PRINTER_MANUAL_CLAIM_CREATE_CHANNEL,
  PRINTER_TECHNICAL_FIELDS_READ_CHANNEL,
  assertAddManualTechnicalClaimRequest,
  assertReadTechnicalFieldsRequest,
} from "../shared/printer-technical-data-api";
import { assertTrustedRendererSender } from "./trusted-renderer";
import type { PrinterTechnicalDataService } from "./printer-technical-data-service";

export function registerPrinterTechnicalDataIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  service: PrinterTechnicalDataService,
  getTrustedRenderer: () => WebContents | undefined
): void {
  ipc.handle(PRINTER_TECHNICAL_FIELDS_READ_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    const request = assertReadTechnicalFieldsRequest(payload);
    return service.readTechnicalFields(request.printerId);
  });
  ipc.handle(PRINTER_MANUAL_CLAIM_CREATE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.addManualClaim(assertAddManualTechnicalClaimRequest(payload));
  });
}
