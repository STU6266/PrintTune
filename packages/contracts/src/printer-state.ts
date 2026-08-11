export interface PrinterState {
  readonly id: string;
  readonly printerId: string;
  readonly parentPrinterStateId?: string;
  readonly createdAt: string;
}
