import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import type { FeatureFlags } from "@printtune/contracts";

import type { AppInfo } from "../shared/app-info";
import { APP_ROUTES, getNavigationClassName } from "./routes";

export function AppShell() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags | null>(null);

  useEffect(() => {
    void window.printTune.getAppInfo().then(setAppInfo);
    void window.printTune.getFeatureFlags().then(setFeatureFlags);
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <header className="brand">
          <span className="brand-mark" aria-hidden="true">
            PT
          </span>
          <div>
            <p>PrintTune</p>
            <span>Desktop Alpha</span>
          </div>
        </header>

        <nav aria-label="Hauptnavigation">
          {APP_ROUTES.map((route) => (
            <NavLink
              key={route.path}
              to={route.path}
              end={route.path === "/"}
              className={({ isActive }) => getNavigationClassName(isActive)}
            >
              {route.label}
            </NavLink>
          ))}
        </nav>

        <footer className="sidebar-footer">
          <p className="alpha-status" aria-live="polite">
            {featureFlags?.internetResearch === false
              ? "Alpha · Internet-Recherche deaktiviert"
              : "Alpha · Status wird geladen …"}
          </p>
          <p className="app-version">
            {appInfo ? `${appInfo.name} ${appInfo.version}` : "PrintTune wird geladen …"}
          </p>
        </footer>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
