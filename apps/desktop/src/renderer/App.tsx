import { useEffect, useState } from "react";

import type { AppInfo } from "../shared/app-info";

export function App() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.printTune.getAppInfo().then(setAppInfo);
  }, []);

  return (
    <main>
      <section aria-labelledby="app-title">
        <p className="eyebrow">PrintTune</p>
        <h1 id="app-title">PrintTune Alpha</h1>
        <ul>
          <li>Desktop-Anwendung läuft</li>
          <li>Renderer isoliert</li>
          <li>Internet-Recherche in der Alpha deaktiviert</li>
        </ul>
        <dl aria-live="polite">
          <div>
            <dt>Anwendung</dt>
            <dd>{appInfo?.name ?? "Wird geladen …"}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{appInfo?.version ?? "Wird geladen …"}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
