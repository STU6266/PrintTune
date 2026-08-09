import { type FormEvent, useState } from "react";

import type {
  ManualTechnicalFieldKey,
  ManualTechnicalFieldValue,
  TechnicalFieldSummary,
} from "../shared/printer-technical-data-api";

type Confirmation = "confirmed" | "uncertain";

interface FieldPresentation {
  readonly label: string;
  readonly inputType: "number" | "text";
  readonly inputUnit?: string;
  readonly help?: string;
}

const FIELD_PRESENTATION: Record<ManualTechnicalFieldKey, FieldPresentation> = {
  nozzleDiameter: { label: "Düsendurchmesser", inputType: "number", inputUnit: "mm" },
  extruderType: { label: "Extrudertyp", inputType: "text" },
  hotendMaxTemperature: {
    label: "Maximale Hotend-Temperatur",
    inputType: "number",
    inputUnit: "°C",
    help: "Technische Obergrenze des Hotends, nicht die normale Drucktemperatur.",
  },
};

export function technicalFieldStatusText(summary: TechnicalFieldSummary): string {
  if (summary.status === "resolved") {
    const unit = summary.unit === "degC" ? " °C" : summary.unit ? ` ${summary.unit}` : "";
    return `Bestätigt: ${String(summary.value).replace(".", ",")}${unit}`;
  }
  if (summary.status === "missing") return "Noch keine Angabe";
  if (summary.status === "conflict") return "Widersprüchliche Angaben";
  if (summary.reasonCode === "insufficient_confirmation") return "Noch nicht bestätigt";
  if (summary.reasonCode === "incompatible_claim_representations") {
    return "Die gespeicherten Angaben sind nicht kompatibel.";
  }
  return "Die Angabe kann derzeit nicht verwendet werden.";
}

interface TechnicalFieldEditorProps {
  readonly summary: TechnicalFieldSummary;
  readonly onSave: (
    field: ManualTechnicalFieldKey,
    value: ManualTechnicalFieldValue,
    confirmation: Confirmation
  ) => Promise<void>;
}

function TechnicalFieldEditor({ summary, onSave }: TechnicalFieldEditorProps) {
  const presentation = FIELD_PRESENTATION[summary.field];
  const [value, setValue] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation>("confirmed");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(undefined);
    const manualValue: ManualTechnicalFieldValue =
      presentation.inputType === "number" ? Number(value) : value.trim();
    if (
      value.trim().length === 0 ||
      (typeof manualValue === "number" && !Number.isFinite(manualValue)) ||
      (typeof manualValue === "string" && manualValue.length === 0)
    ) {
      setError(
        presentation.inputType === "number"
          ? "Bitte gib eine gültige Zahl ein."
          : "Bitte gib einen Extrudertyp ein."
      );
      return;
    }

    setIsSaving(true);
    try {
      await onSave(summary.field, manualValue, confirmation);
      setValue("");
    } catch {
      setError("Die technische Angabe konnte nicht gespeichert werden.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="technical-field-card">
      <header>
        <h3>{presentation.label}</h3>
        <p className={`technical-status technical-status-${summary.status}`}>
          {technicalFieldStatusText(summary)}
        </p>
      </header>
      {presentation.help ? <p className="technical-help">{presentation.help}</p> : null}
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor={`technical-value-${summary.field}`}>Neue eigene Angabe</label>
        <div className="technical-value-input">
          <input
            id={`technical-value-${summary.field}`}
            type={presentation.inputType}
            step={presentation.inputType === "number" ? "any" : undefined}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={isSaving}
          />
          {presentation.inputUnit ? <span>{presentation.inputUnit}</span> : null}
        </div>
        <label htmlFor={`technical-confirmation-${summary.field}`}>Sicherheit der Angabe</label>
        <select
          id={`technical-confirmation-${summary.field}`}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value as Confirmation)}
          disabled={isSaving}
        >
          <option value="confirmed">Ich bin mir sicher</option>
          <option value="uncertain">Ich bin mir nicht sicher</option>
        </select>
        <button type="submit" disabled={isSaving}>
          {isSaving ? "Wird gespeichert …" : "Angabe speichern"}
        </button>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </article>
  );
}

interface PrinterTechnicalDataSectionProps {
  readonly fields: readonly TechnicalFieldSummary[];
  readonly isLoading: boolean;
  readonly onSave: TechnicalFieldEditorProps["onSave"];
}

export function PrinterTechnicalDataSection({
  fields,
  isLoading,
  onSave,
}: PrinterTechnicalDataSectionProps) {
  return (
    <section className="technical-data" aria-labelledby="technical-data-title">
      <div>
        <p className="development-label">Eigene Angaben und PrintTune-Auswertung</p>
        <h2 id="technical-data-title">Technische Angaben</h2>
      </div>
      {isLoading ? <p role="status">Technische Angaben werden ausgewertet …</p> : null}
      {!isLoading ? (
        <div className="technical-field-list">
          {fields.map((field) => (
            <TechnicalFieldEditor key={field.field} summary={field} onSave={onSave} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
