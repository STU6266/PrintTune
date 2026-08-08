import { HashRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./AppShell";
import { APP_ROUTES, DEFAULT_ROUTE, UNKNOWN_ROUTE_REDIRECT } from "./routes";

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppShell />}>
          {APP_ROUTES.map(({ path, Component }) =>
            path === DEFAULT_ROUTE ? (
              <Route key={path} index element={<Component />} />
            ) : (
              <Route key={path} path={path.slice(1)} element={<Component />} />
            )
          )}
          <Route path="*" element={<Navigate to={UNKNOWN_ROUTE_REDIRECT} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
