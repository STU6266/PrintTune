import type { IpcMainInvokeEvent, WebContents } from "electron";

export class UntrustedRendererError extends Error {
  override readonly name = "UntrustedRendererError";

  constructor() {
    super("Workspace IPC request rejected from an untrusted sender");
  }
}

export function assertTrustedRendererSender(
  event: Pick<IpcMainInvokeEvent, "sender">,
  trustedRenderer: WebContents | undefined
): void {
  if (!trustedRenderer || event.sender !== trustedRenderer || trustedRenderer.isDestroyed()) {
    throw new UntrustedRendererError();
  }
}
