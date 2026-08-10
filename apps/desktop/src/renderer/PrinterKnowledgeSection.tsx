import { type RefObject, useEffect, useRef, useState } from "react";

import type {
  PrinterKnowledgeApi,
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
  readonly pending: PendingSelection | undefined;
  readonly message: string | undefined;
  readonly error: string | undefined;
  readonly disclosureButtonRef?: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
  readonly onCancel: () => void;
  readonly onSelect: (selection: PendingSelection) => void;
  readonly onConfirm: () => void;
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
  pending,
  message,
  error,
  disclosureButtonRef,
  onOpen,
  onCancel,
  onSelect,
  onConfirm,
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
        </>
      ) : null}
      {!isLoading && status ? (
        <button
          ref={disclosureButtonRef}
          type="button"
          className="knowledge-primary"
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
                  disabled={isSaving}
                  onClick={() => onSelect(knownPending(item))}
                >
                  Ganze Serie
                </button>
                {item.models.map((model) => (
                  <button
                    key={model.selection.modelDefinitionId}
                    type="button"
                    disabled={isSaving}
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
            disabled={isSaving}
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
              <button type="button" disabled={isSaving} onClick={onConfirm}>
                {isSaving ? "Wird gespeichert …" : "Druckermodell bestätigen"}
              </button>
            </div>
          ) : null}
          <button type="button" disabled={isSaving} onClick={onCancel}>
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

export function PrinterKnowledgeSection({ printerId }: { readonly printerId: string }) {
  const [status, setStatus] = useState<PrinterKnowledgeStatus>();
  const [catalog, setCatalog] = useState<PrinterKnowledgeCatalog>();
  const [isLoading, setIsLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pending, setPending] = useState<PendingSelection>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const saving = useRef(false);
  const generation = useRef(0);
  const pendingPrinterId = useRef<string | undefined>(undefined);
  const disclosureButton = useRef<HTMLButtonElement>(null);

  async function refresh(expectedGeneration: number, targetPrinterId: string): Promise<boolean> {
    const [nextStatus, nextCatalog] = await Promise.all([
      window.printTune.getPrinterKnowledgeStatus(targetPrinterId),
      window.printTune.listPrinterKnowledgeCatalog(),
    ]);
    if (generation.current !== expectedGeneration) return false;
    setStatus(nextStatus);
    setCatalog(nextCatalog);
    return true;
  }

  useEffect(() => {
    const expectedGeneration = ++generation.current;
    saving.current = false;
    setStatus(undefined);
    setCatalog(undefined);
    setIsLoading(true);
    setIsOpen(false);
    setIsSaving(false);
    setPending(undefined);
    pendingPrinterId.current = undefined;
    setMessage(undefined);
    setError(undefined);
    void refresh(expectedGeneration, printerId)
      .catch(() => {
        if (generation.current === expectedGeneration)
          setError("Druckermodell und Wissen konnten nicht geladen werden.");
      })
      .finally(() => {
        if (generation.current === expectedGeneration) setIsLoading(false);
      });
    return () => {
      if (generation.current === expectedGeneration) generation.current += 1;
    };
  }, [printerId]);

  async function confirm(): Promise<void> {
    if (!pending || pendingPrinterId.current !== printerId || saving.current) return;
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

  return (
    <PrinterKnowledgeSectionView
      status={status}
      catalog={catalog}
      isLoading={isLoading}
      isOpen={isOpen}
      isSaving={isSaving}
      pending={pending}
      message={message}
      error={error}
      disclosureButtonRef={disclosureButton}
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
    />
  );
}
