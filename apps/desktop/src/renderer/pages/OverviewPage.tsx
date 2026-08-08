import { type FormEvent, useEffect, useState } from "react";

import type { Workspace } from "@printtune/contracts";

import { isWorkspaceActive } from "../workspace-selection";

export function OverviewPage() {
  const [workspaces, setWorkspaces] = useState<readonly Workspace[]>([]);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | undefined>();
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [selectingWorkspaceId, setSelectingWorkspaceId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState(false);

  useEffect(() => {
    void Promise.all([window.printTune.listWorkspaces(), window.printTune.getActiveWorkspace()])
      .then(([loadedWorkspaces, loadedActiveWorkspace]) => {
        setWorkspaces(loadedWorkspaces);
        setActiveWorkspace(loadedActiveWorkspace);
      })
      .catch(() => setLoadError(true))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreateError(null);

    if (name.trim().length === 0) {
      setCreateError("Bitte gib einen Namen für den Arbeitsbereich ein.");
      return;
    }

    setIsCreating(true);
    try {
      await window.printTune.createWorkspace({ name });
      const [loadedWorkspaces, loadedActiveWorkspace] = await Promise.all([
        window.printTune.listWorkspaces(),
        window.printTune.getActiveWorkspace(),
      ]);
      setWorkspaces(loadedWorkspaces);
      setActiveWorkspace(loadedActiveWorkspace);
      setName("");
    } catch {
      setCreateError("Der Arbeitsbereich konnte nicht erstellt werden. Bitte prüfe den Namen.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleSelect(id: string): Promise<void> {
    setSelectionError(false);
    setSelectingWorkspaceId(id);

    try {
      setActiveWorkspace(await window.printTune.setActiveWorkspace(id));
    } catch {
      setSelectionError(true);
    } finally {
      setSelectingWorkspaceId(null);
    }
  }

  return (
    <section className="page" aria-labelledby="overview-title">
      <h1 id="overview-title">Übersicht</h1>
      <p>Zentrale Übersicht über deinen PrintTune-Arbeitsbereich.</p>

      <section className="workspace-development" aria-labelledby="workspace-title">
        <div>
          <p className="development-label">Entwicklungsstand</p>
          <h2 id="workspace-title">Arbeitsbereiche</h2>
        </div>

        {isLoading ? <p role="status">Arbeitsbereiche werden geladen …</p> : null}
        {loadError ? (
          <p className="form-error" role="alert">
            Arbeitsbereiche konnten nicht geladen werden.
          </p>
        ) : null}
        {!isLoading && !loadError ? (
          <>
            <p>
              {workspaces.length === 1
                ? "1 Arbeitsbereich vorhanden."
                : `${workspaces.length} Arbeitsbereiche vorhanden.`}
            </p>
            <p className="active-workspace-status" aria-live="polite">
              {activeWorkspace
                ? `Aktiver Arbeitsbereich: ${activeWorkspace.name}`
                : "Kein aktiver Arbeitsbereich ausgewählt."}
            </p>
            {workspaces.length === 0 ? (
              <p>Noch keine Arbeitsbereiche angelegt.</p>
            ) : (
              <ul className="workspace-list">
                {workspaces.map((workspace) => {
                  const isActive = isWorkspaceActive(activeWorkspace, workspace);

                  return (
                    <li
                      key={workspace.id}
                      className={isActive ? "workspace-list-item-active" : undefined}
                    >
                      <span>{workspace.name}</span>
                      <button
                        type="button"
                        onClick={() => void handleSelect(workspace.id)}
                        disabled={isActive || selectingWorkspaceId !== null}
                        aria-pressed={isActive}
                      >
                        {isActive
                          ? "Aktiv"
                          : selectingWorkspaceId === workspace.id
                            ? "Wird ausgewählt …"
                            : "Auswählen"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {selectionError ? (
              <p className="form-error" role="alert">
                Der Arbeitsbereich konnte nicht ausgewählt werden.
              </p>
            ) : null}
          </>
        ) : null}

        <form className="workspace-form" onSubmit={(event) => void handleCreate(event)}>
          <label htmlFor="workspace-name">Name</label>
          <div>
            <input
              id="workspace-name"
              name="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isCreating}
              autoComplete="off"
            />
            <button type="submit" disabled={isCreating || isLoading || loadError}>
              {isCreating ? "Wird erstellt …" : "Arbeitsbereich erstellen"}
            </button>
          </div>
          {createError ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
        </form>
      </section>
    </section>
  );
}
