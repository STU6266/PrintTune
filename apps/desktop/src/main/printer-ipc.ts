import type { IpcMain, WebContents } from "electron";

import {
  PRINTER_CREATE_CHANNEL,
  PRINTER_GET_DETAIL_CHANNEL,
  PRINTER_LIST_CHANNEL,
  assertCreatePrinterRequest,
  assertGetPrinterDetailRequest,
} from "../shared/printer-api";
import type { PrinterFlowApplicationService } from "./printer-flow-application-service";
import { assertTrustedRendererSender } from "./trusted-renderer";

export function registerPrinterIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  service: PrinterFlowApplicationService,
  getTrustedRenderer: () => WebContents | undefined
): void {
  ipc.handle(PRINTER_LIST_CHANNEL, async (event) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.listPrinters();
  });
  ipc.handle(PRINTER_CREATE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.createPrinter(assertCreatePrinterRequest(payload).name);
  });
  ipc.handle(PRINTER_GET_DETAIL_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    return service.getPrinterDetail(assertGetPrinterDetailRequest(payload).id);
  });
}
