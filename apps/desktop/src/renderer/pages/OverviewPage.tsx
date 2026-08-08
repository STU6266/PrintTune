import { type FormEvent, useEffect, useReducer, useState } from "react";

import type { Workspace } from "@printtune/contracts";

import {
  INITIAL_WORKSPACE_MANAGEMENT_STATE,
  reduceWorkspaceManagementState,
} from "../workspace-management-state";
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
  const [managementError, setManagementError] = useState<string | null>(null);
  const [managingWorkspaceId, setManagingWorkspaceId] = useState<string | null>(null);
  const [managementState, dispatchManagement] = useReducer(
    reduceWorkspaceManagementState,
    INITIAL_WORKSPACE_MANAGEMENT_STATE
  );

  async function refreshWorkspaceState(): Promise<void> {
    const [loadedWorkspaces, loadedActiveWorkspace] = await Promise.all([
      window.printTune.listWorkspaces(),
      window.printTune.getActiveWorkspace(),
    ]);
    setWorkspaces(loadedWorkspaces);
    setActiveWorkspace(loadedActiveWorkspace);
  }

  useEffect(() => {
    void refreshWorkspaceState()
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
      await refreshWorkspaceState();
      setName("");
    } catch {
      setCreateError("Der Arbeitsbereich konnte nicht erstellt werden. Bitte prüfe den Namen.");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRename(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const rename = managementState.rename;
    if (!rename) {
      return;
    }

    setManagementError(null);
    if (rename.name.trim().length === 0) {
      setManagementError("Bitte gib einen Namen für den Arbeitsbereich ein.");
      return;
    }

    setManagingWorkspaceId(rename.id);
    try {
      await window.printTune.renameWorkspace(rename.id, rename.name);
      await refreshWorkspaceState();
      dispatchManagement({ type: "reset" });
    } catch {
      setManagementError("Der Arbeitsbereich konnte nicht umbenannt werden.");
    } finally {
      setManagingWorkspaceId(null);
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setManagementError(null);
    setManagingWorkspaceId(id);

    try {
      await window.printTune.deleteWorkspace(id);
      await refreshWorkspaceState();
      dispatchManagement({ type: "reset" });
    } catch {
      setManagementError("Der Arbeitsbereich konnte nicht gelöscht werden.");
    } finally {
      setManagingWorkspaceId(null);
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
                  const isRenaming = managementState.rename?.id === workspace.id;
                  const isConfirmingDelete = managementState.deleteConfirmationId === workspace.id;

                  return (
                    <li
                      key={workspace.id}
                      className={isActive ? "workspace-list-item-active" : undefined}
                    >
                      {isRenaming ? (
                        <form
                          className="workspace-rename-form"
                          onSubmit={(event) => void handleRename(event)}
                        >
                          <label htmlFor={`rename-${workspace.id}`}>Neuer Name</label>
                          <input
                            id={`rename-${workspace.id}`}
                            value={managementState.rename?.name ?? ""}
                            onChange={(event) =>
                              dispatchManagement({
                                type: "change-rename-name",
                                name: event.target.value,
                              })
                            }
                            disabled={managingWorkspaceId !== null}
                            autoFocus
                          />
                          <button type="submit" disabled={managingWorkspaceId !== null}>
                            Speichern
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatchManagement({ type: "cancel-rename" })}
                            disabled={managingWorkspaceId !== null}
                          >
                            Abbrechen
                          </button>
                        </form>
                      ) : isConfirmingDelete ? (
                        <div className="workspace-delete-confirmation">
                          <span>Arbeitsbereich wirklich löschen?</span>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => void handleDelete(workspace.id)}
                            disabled={managingWorkspaceId !== null}
                          >
                            Löschen
                          </button>
                          <button
                            type="button"
                            onClick={() => dispatchManagement({ type: "cancel-delete" })}
                            disabled={managingWorkspaceId !== null}
                          >
                            Abbrechen
                          </button>
                        </div>
                      ) : (
                        <>
                          <span>{workspace.name}</span>
                          <div className="workspace-actions">
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
                            <button
                              type="button"
                              onClick={() =>
                                dispatchManagement({ type: "begin-rename", workspace })
                              }
                            >
                              Umbenennen
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                dispatchManagement({ type: "request-delete", id: workspace.id })
                              }
                            >
                              Löschen
                            </button>
                          </div>
                        </>
                      )}
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
            {managementError ? (
              <p className="form-error" role="alert">
                {managementError}
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
