import { type FormEvent, useEffect, useState } from "react";

import type { Printer, Workspace } from "@printtune/contracts";

import type { PrinterDetailResponse } from "../../shared/printer-api";
import type {
  AddManualTechnicalClaimRequest,
  TechnicalFieldSummary,
} from "../../shared/printer-technical-data-api";
import { PrinterTechnicalDataSection } from "../PrinterTechnicalDataSection";
import { PrinterKnowledgeSection } from "../PrinterKnowledgeSection";

interface PrintersPageViewProps {
  readonly activeWorkspace: Workspace | undefined;
  readonly printers: readonly Printer[];
  readonly detail: PrinterDetailResponse | undefined;
  readonly name: string;
  readonly isLoading: boolean;
  readonly isCreating: boolean;
  readonly error: string | undefined;
  readonly technicalFields?: readonly TechnicalFieldSummary[];
  readonly technicalFieldsLoading?: boolean;
  readonly onNameChange: (name: string) => void;
  readonly onCreate: (event: FormEvent<HTMLFormElement>) => void;
  readonly onOpen: (id: string) => void;
  readonly onSaveTechnicalField?: (
    input: Omit<AddManualTechnicalClaimRequest, "printerId">
  ) => Promise<void>;
}

export function formatPrinterTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function PrintersPageView({
  activeWorkspace,
  printers,
  detail,
  name,
  isLoading,
  isCreating,
  error,
  technicalFields = [],
  technicalFieldsLoading = false,
  onNameChange,
  onCreate,
  onOpen,
  onSaveTechnicalField = async () => {},
}: PrintersPageViewProps) {
  return (
    <section className="page printer-page" aria-labelledby="printers-title">
      <h1 id="printers-title">Drucker</h1>
      {isLoading ? <p role="status">Drucker werden geladen …</p> : null}
      {!isLoading && !activeWorkspace ? <p>Wähle zuerst einen Workspace aus.</p> : null}
      {!isLoading && activeWorkspace ? (
        <>
          <p>Drucker im Arbeitsbereich „{activeWorkspace.name}“.</p>

          <form className="printer-form" onSubmit={onCreate}>
            <label htmlFor="printer-name">Druckername</label>
            <div>
              <input
                id="printer-name"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                disabled={isCreating}
              />
              <button type="submit" disabled={isCreating}>
                {isCreating ? "Wird angelegt …" : "Drucker anlegen"}
              </button>
            </div>
          </form>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <section className="printer-section" aria-labelledby="printer-list-title">
            <h2 id="printer-list-title">Vorhandene Drucker</h2>
            {printers.length === 0 ? (
              <p>Noch keine Drucker in diesem Workspace angelegt.</p>
            ) : (
              <ul className="printer-list">
                {printers.map((printer) => (
                  <li key={printer.id}>
                    <div>
                      <strong>{printer.name}</strong>
                      <span>Angelegt: {formatPrinterTimestamp(printer.createdAt)}</span>
                    </div>
                    <button type="button" onClick={() => onOpen(printer.id)}>
                      Öffnen
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail ? (
            <section className="printer-detail" aria-labelledby="printer-detail-title">
              <p className="development-label">Druckerdetails</p>
              <h2 id="printer-detail-title">{detail.printer.name}</h2>
              <dl>
                <div>
                  <dt>Angelegt</dt>
                  <dd>{formatPrinterTimestamp(detail.printer.createdAt)}</dd>
                </div>
                <div>
                  <dt>Initialer Druckerzustand</dt>
                  <dd>{formatPrinterTimestamp(detail.initialState.createdAt)}</dd>
                </div>
              </dl>
              <p>Dieser unveränderliche Zustand wurde beim Anlegen des Druckers erstellt.</p>
              <PrinterKnowledgeSection printerId={detail.printer.id} />
              <PrinterTechnicalDataSection
                fields={technicalFields}
                isLoading={technicalFieldsLoading}
                onSave={(field, value, confirmation) =>
                  onSaveTechnicalField({ field, value, confirmation })
                }
              />
            </section>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export function PrintersPage() {
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | undefined>();
  const [printers, setPrinters] = useState<readonly Printer[]>([]);
  const [detail, setDetail] = useState<PrinterDetailResponse | undefined>();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [technicalFields, setTechnicalFields] = useState<readonly TechnicalFieldSummary[]>([]);
  const [technicalFieldsLoading, setTechnicalFieldsLoading] = useState(false);

  async function refresh(): Promise<void> {
    const response = await window.printTune.listPrinters();
    setActiveWorkspace(response.activeWorkspace);
    setPrinters(response.printers);
    if (detail && !response.printers.some((printer) => printer.id === detail.printer.id)) {
      setDetail(undefined);
      setTechnicalFields([]);
    }
  }

  useEffect(() => {
    void refresh()
      .catch(() => setError("Die Drucker konnten nicht geladen werden."))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    if (name.trim().length === 0) {
      setError("Bitte gib einen Namen für den Drucker ein.");
      return;
    }

    setIsCreating(true);
    try {
      const created = await window.printTune.createPrinter(name);
      await refresh();
      setTechnicalFieldsLoading(true);
      const fields = await window.printTune.readPrinterTechnicalFields(created.printer.id);
      setDetail(created);
      setTechnicalFields(fields);
      setName("");
    } catch {
      setError("Der Drucker konnte nicht angelegt werden. Bitte prüfe den Namen.");
    } finally {
      setIsCreating(false);
      setTechnicalFieldsLoading(false);
    }
  }

  async function handleOpen(id: string): Promise<void> {
    setError(undefined);
    try {
      setTechnicalFieldsLoading(true);
      const [loadedDetail, fields] = await Promise.all([
        window.printTune.getPrinterDetail(id),
        window.printTune.readPrinterTechnicalFields(id),
      ]);
      setDetail(loadedDetail);
      setTechnicalFields(fields);
    } catch {
      setDetail(undefined);
      setError("Der Drucker konnte nicht geöffnet werden.");
    } finally {
      setTechnicalFieldsLoading(false);
    }
  }

  async function handleSaveTechnicalField(
    input: Omit<AddManualTechnicalClaimRequest, "printerId">
  ): Promise<void> {
    if (!detail) return;
    setTechnicalFields(
      await window.printTune.addManualPrinterTechnicalClaim({
        printerId: detail.printer.id,
        ...input,
      })
    );
  }

  return (
    <PrintersPageView
      activeWorkspace={activeWorkspace}
      printers={printers}
      detail={detail}
      name={name}
      isLoading={isLoading}
      isCreating={isCreating}
      error={error}
      technicalFields={technicalFields}
      technicalFieldsLoading={technicalFieldsLoading}
      onNameChange={setName}
      onCreate={(event) => void handleCreate(event)}
      onOpen={(id) => void handleOpen(id)}
      onSaveTechnicalField={handleSaveTechnicalField}
    />
  );
}
