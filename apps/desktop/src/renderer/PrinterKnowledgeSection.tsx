import { type RefObject, useEffect, useRef, useState } from "react";

import type {
  PrinterKnowledgeApi,
  PrinterKnowledgeApplicationStatus,
  PrinterKnowledgeCatalog,
  PrinterKnowledgeCatalogItem,
  PrinterKnowledgeCatalogModel,
  PrinterKnowledgeClassificationResult,
  PrinterKnowledgeModelSelection,
  PrinterKnowledgeSeriesSelection,
  PrinterKnowledgeStatus,
} from "../shared/printer-knowledge-ui-api";
import { PrinterKnowledgeApiError } from "../shared/printer-knowledge-ui-api";

type PendingSelection =
  | { readonly kind: "unclassified" }
  | {
      readonly kind: "known";
      readonly selection: PrinterKnowledgeSeriesSelection | PrinterKnowledgeModelSelection;
      readonly manufacturerDisplayName: string;
      readonly seriesDisplayName: string;
      readonly modelDisplayName?: string;
    };

interface PrinterKnowledgeSectionViewProps {
  readonly status: PrinterKnowledgeStatus | undefined;
  readonly catalog: PrinterKnowledgeCatalog | undefined;
  readonly isLoading: boolean;
  readonly isOpen: boolean;
  readonly isSaving: boolean;
  readonly applicationStatus: PrinterKnowledgeApplicationStatus | undefined;
  readonly isApplicationLoading: boolean;
  readonly isApplyConfirming: boolean;
  readonly isApplying: boolean;
  readonly pending: PendingSelection | undefined;
  readonly message: string | undefined;
  readonly error: string | undefined;
  readonly disclosureButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly applyButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSelect: (selection: PendingSelection) => void;
  readonly onConfirm: () => void;
  readonly onOpenApply: () => void;
  readonly onCancelApply: () => void;
  readonly onConfirmApply: () => void;
}

function knownPending(
  item: PrinterKnowledgeCatalogItem,
  model?: PrinterKnowledgeCatalogModel
): PendingSelection {
  return {
    kind: "known",
    selection: model?.selection ?? item.selection,
    manufacturerDisplayName: item.manufacturerDisplayName,
    seriesDisplayName: item.seriesDisplayName,
    ...(model === undefined ? {} : { modelDisplayName: model.modelDisplayName }),
  };
}

function hasSeriesDisplayCollision(
  catalog: PrinterKnowledgeCatalog,
  item: PrinterKnowledgeCatalogItem
): boolean {
  return catalog.items.some(
    (candidate) =>
      candidate !== item &&
      candidate.manufacturerDisplayName === item.manufacturerDisplayName &&
      candidate.seriesDisplayName === item.seriesDisplayName
  );
}

function hasExactDisplayCollision(
  catalog: PrinterKnowledgeCatalog,
  item: PrinterKnowledgeCatalogItem
): boolean {
  return catalog.items.some(
    (candidate) =>
      candidate !== item &&
      candidate.manufacturerDisplayName === item.manufacturerDisplayName &&
      candidate.seriesDisplayName === item.seriesDisplayName &&
      candidate.selection.packageVersion === item.selection.packageVersion
  );
}

function hasModelDisplayCollision(
  item: PrinterKnowledgeCatalogItem,
  model: PrinterKnowledgeCatalogModel
): boolean {
  return item.models.some(
    (candidate) => candidate !== model && candidate.modelDisplayName === model.modelDisplayName
  );
}

export function PrinterKnowledgeSectionView({
  status,
  catalog,
  isLoading,
  isOpen,
  isSaving,
  applicationStatus,
  isApplicationLoading,
  isApplyConfirming,
  isApplying,
  pending,
  message,
  error,
  disclosureButtonRef,
  applyButtonRef,
  onOpen,
  onCancel,
  onSelect,
  onConfirm,
  onOpenApply,
  onCancelApply,
  onConfirmApply,
}: PrinterKnowledgeSectionViewProps) {
  return (
    <section className="printer-knowledge" aria-labelledby="printer-knowledge-title">
      <h2 id="printer-knowledge-title">Druckermodell und Wissen</h2>
      {isLoading ? <p role="status">Druckermodell wird geladen …</p> : null}
      {!isLoading && status?.kind === "no_selection" ? (
        <>
          <strong>Noch kein Druckermodell ausgewählt.</strong>
          <p>Durch die Auswahl kann PrintTune bekannte technische Informationen zuordnen.</p>
          <p>
            Die Auswahl ist optional. Du kannst technische Angaben weiterhin manuell eintragen; am
            Drucker selbst wird nichts verändert.
          </p>
        </>
      ) : null}
      {!isLoading && status?.kind === "unclassified" ? (
        <>
          <p className="knowledge-label">Druckermodell</p>
          <strong>Unbekannt / Eigenbau</strong>
          <p>Technische Angaben können weiterhin manuell erfasst werden.</p>
        </>
      ) : null}
      {!isLoading && status?.kind === "known" ? (
        <>
          <p className="knowledge-label">Druckermodell</p>
          <strong>{status.manufacturerDisplayName}</strong>
          <p>
            {status.seriesDisplayName}
            {status.modelDisplayName ? ` – ${status.modelDisplayName}` : ""}
          </p>
          {status.packageAvailability === "available" ? (
            <p className="knowledge-availability knowledge-available">
              Wissenspaket verfügbar. Das passende lokale PrintTune-Wissenspaket ist vorhanden.
            </p>
          ) : null}
          {status.packageAvailability === "unavailable" ? (
            <p className="knowledge-availability knowledge-warning">
              Wissenspaket nicht verfügbar. Die gespeicherte Druckermodell-Auswahl bleibt erhalten.
              Bereits vorhandene technische Informationen gehen nicht verloren.
            </p>
          ) : null}
          {status.packageAvailability === "unusable" ? (
            <p className="knowledge-availability knowledge-warning">
              Wissenspaket kann derzeit nicht verwendet werden.
            </p>
          ) : null}
          <div className="knowledge-application">
            <p className="knowledge-label">Druckerwissen</p>
            {isApplicationLoading ? <p role="status">Anwendungsstatus wird geladen …</p> : null}
            {!isApplicationLoading &&
            applicationStatus?.kind === "known" &&
            applicationStatus.applicationStatus === "applied" ? (
              <>
                <strong>Druckerwissen angewendet</strong>
                <p>
                  Bekannte technische Basisdaten wurden diesem Druckerzustand bereits in PrintTune
                  zugeordnet.
                </p>
              </>
            ) : null}
            {!isApplicationLoading &&
            applicationStatus?.kind === "known" &&
            applicationStatus.applicationStatus === "not_applied" &&
            status.packageAvailability === "available" ? (
              <>
                <strong>Noch nicht angewendet</strong>
                <p>
                  PrintTune fügt bekannte technische Basisdaten aus dem lokalen Wissenspaket zu
                  diesem Druckerzustand hinzu.
                </p>
                <p>
                  Eigene bestätigte Angaben bleiben erhalten. Am Drucker, an der Firmware und an
                  Slicer-Dateien wird nichts verändert. Es wird kein G-Code gesendet.
                </p>
                {!isApplyConfirming ? (
                  <button
                    ref={applyButtonRef}
                    type="button"
                    className="knowledge-primary"
                    disabled={isApplying || isSaving}
                    onClick={onOpenApply}
                  >
                    Druckerwissen anwenden
                  </button>
                ) : (
                  <div className="knowledge-confirmation">
                    <strong>Druckerwissen anwenden?</strong>
                    <p>
                      PrintTune übernimmt bekannte technische Basisdaten in die interne Wissensbasis
                      dieses Druckerzustands.
                    </p>
                    <p>Am Drucker selbst wird nichts verändert.</p>
                    <button type="button" disabled={isApplying} onClick={onConfirmApply}>
                      {isApplying ? "Wissen wird angewendet …" : "Wissen anwenden"}
                    </button>
                    <button type="button" disabled={isApplying} onClick={onCancelApply}>
                      Abbrechen
                    </button>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </>
      ) : null}
      {!isLoading && status ? (
        <button
          ref={disclosureButtonRef}
          type="button"
          className="knowledge-primary"
          disabled={isApplying}
          aria-expanded={isOpen}
          aria-controls="printer-knowledge-selector"
          onClick={onOpen}
        >
          {status.kind === "no_selection" ? "Druckermodell auswählen" : "Druckermodell ändern"}
        </button>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}

      {isOpen && catalog ? (
        <div
          id="printer-knowledge-selector"
          className="knowledge-selector"
          aria-labelledby="knowledge-selector-title"
        >
          <h3 id="knowledge-selector-title">Druckermodell auswählen</h3>
          {catalog.unusablePackageCount > 0 ? (
            <p className="knowledge-warning">
              Ein oder mehrere lokale Wissenspakete konnten nicht verwendet werden.
            </p>
          ) : null}
          {catalog.items.length === 0 ? <p>Keine lokalen Druckermodelle verfügbar.</p> : null}
          <div className="knowledge-catalog">
            {catalog.items.map((item) => (
              <fieldset key={`${item.selection.packageId}\u0000${item.selection.packageVersion}`}>
                <legend>{item.manufacturerDisplayName}</legend>
                <strong>{item.seriesDisplayName}</strong>
                {hasSeriesDisplayCollision(catalog, item) ? (
                  <small>Version {item.selection.packageVersion}</small>
                ) : null}
                {hasExactDisplayCollision(catalog, item) ? (
                  <small>Paket: {item.selection.packageId}</small>
                ) : null}
                <button
                  type="button"
                  disabled={isSaving || isApplying}
                  onClick={() => onSelect(knownPending(item))}
                >
                  Ganze Serie
                </button>
                {item.models.map((model) => (
                  <button
                    key={model.selection.modelDefinitionId}
                    type="button"
                    disabled={isSaving || isApplying}
                    onClick={() => onSelect(knownPending(item, model))}
                  >
                    {model.modelDisplayName}
                    {hasModelDisplayCollision(item, model)
                      ? ` · ${model.selection.modelDefinitionId}`
                      : ""}
                  </button>
                ))}
              </fieldset>
            ))}
          </div>
          <button
            type="button"
            disabled={isSaving || isApplying}
            onClick={() => onSelect({ kind: "unclassified" })}
          >
            Unbekannt / Eigenbau
          </button>
          {pending ? (
            <div className="knowledge-confirmation">
              <p>Ausgewählt:</p>
              <strong>
                {pending.kind === "unclassified"
                  ? "Unbekannt / Eigenbau"
                  : pending.manufacturerDisplayName}
              </strong>
              {pending.kind === "known" ? (
                <p>
                  {pending.seriesDisplayName}
                  {pending.modelDisplayName ? ` – ${pending.modelDisplayName}` : ""}
                </p>
              ) : (
                <p>Die bisherigen technischen Angaben bleiben erhalten.</p>
              )}
              <button type="button" disabled={isSaving || isApplying} onClick={onConfirm}>
                {isSaving ? "Wird gespeichert …" : "Druckermodell bestätigen"}
              </button>
            </div>
          ) : null}
          <button type="button" disabled={isSaving || isApplying} onClick={onCancel}>
            Abbrechen
          </button>
        </div>
      ) : null}
    </section>
  );
}

export async function confirmPrinterKnowledgeSelection(
  api: PrinterKnowledgeApi,
  printerId: string,
  pending: PendingSelection
): Promise<PrinterKnowledgeClassificationResult> {
  return pending.kind === "unclassified"
    ? api.classifyUnclassifiedPrinter({ printerId })
    : api.classifyKnownPrinter({ printerId, selection: pending.selection });
}

export function printerKnowledgeErrorMessage(error: unknown): string {
  if (error instanceof PrinterKnowledgeApiError) {
    if (error.code === "package_unavailable")
      return "Dieses Druckermodell ist nicht mehr verfügbar. Bitte aktualisiere die Auswahl.";
    if (error.code === "package_unusable")
      return "Diese Auswahl kann nicht mehr verwendet werden. Bitte wähle das Druckermodell erneut aus.";
  }
  return "Das Druckermodell konnte nicht gespeichert werden.";
}

export function PrinterKnowledgeSection({
  printerId,
  refreshKey = 0,
  onKnowledgeApplied,
}: {
  readonly printerId: string;
  readonly refreshKey?: number;
  readonly onKnowledgeApplied?: () => void | Promise<void>;
}) {
  const [status, setStatus] = useState<PrinterKnowledgeStatus>();
  const [catalog, setCatalog] = useState<PrinterKnowledgeCatalog>();
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [applicationStatus, setApplicationStatus] = useState<PrinterKnowledgeApplicationStatus>();
  const [isApplicationLoading, setIsApplicationLoading] = useState(true);
  const [isApplyConfirming, setIsApplyConfirming] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [pending, setPending] = useState<PendingSelection>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const applying = useRef(false);
  const generation = useRef(0);
  const pendingPrinterId = useRef<string | undefined>(undefined);
  const disclosureButton = useRef<HTMLButtonElement>(null);
  const applyButton = useRef<HTMLButtonElement>(null);
  const focusApplyAfterCancel = useRef(false);
  const focusDisclosureAfterApply = useRef(false);

  useEffect(() => {
    if (focusApplyAfterCancel.current && !isApplyConfirming) {
      focusApplyAfterCancel.current = false;
      applyButton.current?.focus();
    }
    if (
      focusDisclosureAfterApply.current &&
      applicationStatus?.kind === "known" &&
      applicationStatus.applicationStatus === "applied"
    ) {
      focusDisclosureAfterApply.current = false;
      disclosureButton.current?.focus();
    }
  });

  async function refresh(expectedGeneration: number, targetPrinterId: string): Promise<boolean> {
    const [nextStatus, nextCatalog] = await Promise.all([
      window.printTune.getPrinterKnowledgeStatus(targetPrinterId),
      window.printTune.listPrinterKnowledgeCatalog(),
    ]);
    if (generation.current !== expectedGeneration) return false;
    setStatus(nextStatus);
    setCatalog(nextCatalog);
    setIsApplicationLoading(true);
    let nextApplicationStatus: PrinterKnowledgeApplicationStatus;
    try {
      nextApplicationStatus = await window.printTune.getPrinterKnowledgeApplicationStatus({
        printerId: targetPrinterId,
        printerStateId: nextStatus.printerState.id,
      });
    } catch {
      if (generation.current !== expectedGeneration) return false;
      setApplicationStatus(undefined);
      setIsApplicationLoading(false);
      setError("Der Anwendungsstatus des Druckerwissens konnte nicht geladen werden.");
      return true;
    }
    if (generation.current !== expectedGeneration) return false;
    setApplicationStatus(nextApplicationStatus);
    setIsApplicationLoading(false);
    return true;
  }

  useEffect(() => {
    const expectedGeneration = ++generation.current;
    saving.current = false;
    applying.current = false;
    setStatus(undefined);
    setCatalog(undefined);
    setApplicationStatus(undefined);
    setIsLoading(true);
    setIsOpen(false);
    setIsSaving(false);
    setIsApplicationLoading(true);
    setIsApplyConfirming(false);
    setIsApplying(false);
    setPending(undefined);
    pendingPrinterId.current = undefined;
    setMessage(undefined);
    setError(undefined);
    void refresh(expectedGeneration, printerId)
      .catch(() => {
        if (generation.current === expectedGeneration) {
          setApplicationStatus(undefined);
          setIsApplicationLoading(false);
          setError("Druckermodell und Wissen konnten nicht geladen werden.");
        }
      })
      .finally(() => {
        if (generation.current === expectedGeneration) setIsLoading(false);
      });
    return () => {
      if (generation.current === expectedGeneration) generation.current += 1;
    };
  }, [printerId, refreshKey]);

  async function confirm(): Promise<void> {
    if (!pending || pendingPrinterId.current !== printerId || saving.current || applying.current)
      return;
    const expectedGeneration = generation.current;
    const targetPrinterId = printerId;
    const selected = pending;
    saving.current = true;
    setIsSaving(true);
    setError(undefined);
    try {
      await confirmPrinterKnowledgeSelection(window.printTune, targetPrinterId, selected);
      if (!(await refresh(expectedGeneration, targetPrinterId))) return;
      setIsOpen(false);
      setPending(undefined);
      setMessage("Druckermodell gespeichert.");
    } catch (caught) {
      if (generation.current !== expectedGeneration) return;
      setError(printerKnowledgeErrorMessage(caught));
      await refresh(expectedGeneration, targetPrinterId).catch(() => undefined);
    } finally {
      if (generation.current === expectedGeneration) {
        saving.current = false;
        setIsSaving(false);
      }
    }
  }

  async function applyKnowledge(): Promise<void> {
    if (applying.current || !status || status.kind !== "known") return;
    const expectedGeneration = generation.current;
    const targetPrinterId = printerId;
    const printerStateId = status.printerState.id;
    applying.current = true;
    setIsApplying(true);
    setError(undefined);
    try {
      const applied = await window.printTune.applyPrinterKnowledge({
        printerId: targetPrinterId,
        printerStateId,
      });
      if (generation.current !== expectedGeneration) return;
      if (!(await refresh(expectedGeneration, targetPrinterId))) return;
      focusDisclosureAfterApply.current = true;
      setIsApplyConfirming(false);
      setMessage(
        applied.status === "already_applied"
          ? "Druckerwissen ist bereits angewendet."
          : "Druckerwissen angewendet."
      );
      try {
        await onKnowledgeApplied?.();
      } catch {
        if (generation.current === expectedGeneration) {
          setError("Die technischen Details konnten nicht aktualisiert werden.");
        }
      }
    } catch (caught) {
      if (generation.current !== expectedGeneration) return;
      setError(printerKnowledgeApplyErrorMessage(caught));
      await refresh(expectedGeneration, targetPrinterId).catch(() => undefined);
    } finally {
      if (generation.current === expectedGeneration) {
        applying.current = false;
        setIsApplying(false);
      }
    }
  }

  return (
    <PrinterKnowledgeSectionView
      status={status}
      catalog={catalog}
      isLoading={isLoading}
      isOpen={isOpen}
      isSaving={isSaving}
      applicationStatus={applicationStatus}
      isApplicationLoading={isApplicationLoading}
      isApplyConfirming={isApplyConfirming}
      isApplying={isApplying}
      pending={pending}
      message={message}
      error={error}
      disclosureButtonRef={disclosureButton}
      applyButtonRef={applyButton}
      onOpen={() => {
        setIsOpen(true);
        setMessage(undefined);
      }}
      onCancel={() => {
        setIsOpen(false);
        setPending(undefined);
        pendingPrinterId.current = undefined;
        queueMicrotask(() => disclosureButton.current?.focus());
      }}
      onSelect={(selection) => {
        pendingPrinterId.current = printerId;
        setPending(selection);
      }}
      onConfirm={() => void confirm()}
      onOpenApply={() => {
        setIsApplyConfirming(true);
        setMessage(undefined);
      }}
      onCancelApply={() => {
        focusApplyAfterCancel.current = true;
        setIsApplyConfirming(false);
      }}
      onConfirmApply={() => void applyKnowledge()}
    />
  );
}

export function printerKnowledgeApplyErrorMessage(error: unknown): string {
  if (error instanceof PrinterKnowledgeApiError) {
    if (error.code === "package_unavailable") return "Das Wissenspaket ist nicht mehr verfügbar.";
    if (error.code === "package_unusable")
      return "Das Wissenspaket kann derzeit nicht angewendet werden.";
    if (error.code === "stale_printer_state")
      return "Der aktuelle Druckerzustand hat sich geändert. Bitte lade die Daten neu.";
  }
  return "Der Anwendungsstatus konnte nicht bestätigt werden. Lade den Status neu oder versuche es erneut.";
}
