import type { IpcMain, WebContents } from "electron";

import {
  PRINTER_STATE_OVERVIEW_GET_CHANNEL,
  PRINTER_STATE_TRANSITION_CREATE_CHANNEL,
  PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL,
  assertCreatePrinterStateTransitionCommand,
  assertPrinterStateLifecycleRequest,
  assertPrinterStateOverview,
  assertPrinterStateTransitionPreparation,
  assertPrinterStateTransitionResult,
  type PrinterStateLifecycleApiErrorCode,
  type PrinterStateLifecycleTransportResult,
} from "../shared/printer-state-lifecycle-api.js";
import {
  PrinterStateLifecycleApplicationError,
  type PrinterStateLifecycleApplicationService,
} from "./printer-state-lifecycle-application-service.js";
import {
  NoActiveWorkspaceError,
  PrinterNotFoundError,
} from "./printer-flow-application-service.js";
import { assertTrustedRendererSender } from "./trusted-renderer.js";

function safeError(
  error: unknown,
  fallback: "read_failed" | "internal_failure"
): PrinterStateLifecycleApiErrorCode {
  if (error instanceof NoActiveWorkspaceError) return "no_active_workspace";
  if (error instanceof PrinterNotFoundError) return "printer_unavailable";
  if (error instanceof PrinterStateLifecycleApplicationError) {
    switch (error.code) {
      case "missing_working_state":
      case "missing_source_state":
        return "missing_working_state";
      case "stale_transition_context":
        return "stale_transition_context";
      case "command_conflict":
        return "command_conflict";
      case "invalid_component_decisions":
        return "invalid_component_decisions";
      case "invalid_claim_decision":
        return "invalid_claim_decisions";
      case "transition_plan_invalid":
        return "transition_unavailable";
      case "transition_persistence_failed":
        return "internal_failure";
    }
  }
  return fallback;
}

function invalidRequest<T>(): PrinterStateLifecycleTransportResult<T> {
  return { ok: false, error: "invalid_request" };
}

async function transport<T>(
  operation: () => Promise<T>,
  assertResult: (value: unknown) => T,
  fallback: "read_failed" | "internal_failure"
): Promise<PrinterStateLifecycleTransportResult<T>> {
  try {
    return { ok: true, value: assertResult(await operation()) };
  } catch (error) {
    return { ok: false, error: safeError(error, fallback) };
  }
}

export function registerPrinterStateLifecycleIpcHandlers(
  ipc: Pick<IpcMain, "handle">,
  service: PrinterStateLifecycleApplicationService,
  getTrustedRenderer: () => WebContents | undefined
): void {
  ipc.handle(PRINTER_STATE_OVERVIEW_GET_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    let request;
    try {
      request = assertPrinterStateLifecycleRequest(payload);
    } catch {
      return invalidRequest();
    }
    return transport(
      () => service.getPrinterStateOverview(request.printerId),
      assertPrinterStateOverview,
      "read_failed"
    );
  });
  ipc.handle(PRINTER_STATE_TRANSITION_PREPARATION_GET_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    let request;
    try {
      request = assertPrinterStateLifecycleRequest(payload);
    } catch {
      return invalidRequest();
    }
    return transport(
      () => service.getTransitionPreparation(request.printerId),
      assertPrinterStateTransitionPreparation,
      "read_failed"
    );
  });
  ipc.handle(PRINTER_STATE_TRANSITION_CREATE_CHANNEL, async (event, payload: unknown) => {
    assertTrustedRendererSender(event, getTrustedRenderer());
    let command;
    try {
      command = assertCreatePrinterStateTransitionCommand(payload);
    } catch {
      return invalidRequest();
    }
    return transport(
      () => service.createPrinterStateTransition(command),
      assertPrinterStateTransitionResult,
      "internal_failure"
    );
  });
}
