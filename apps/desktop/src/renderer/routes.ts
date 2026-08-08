import type { ComponentType } from "react";

import { AssistantPage } from "./pages/AssistantPage";
import { KnowledgePage } from "./pages/KnowledgePage";
import { OverviewPage } from "./pages/OverviewPage";
import { PrintersPage } from "./pages/PrintersPage";
import { SettingsPage } from "./pages/SettingsPage";

export interface AppRoute {
  path: string;
  label: string;
  Component: ComponentType;
}

export const DEFAULT_ROUTE = "/";
export const UNKNOWN_ROUTE_REDIRECT = DEFAULT_ROUTE;

export const APP_ROUTES = [
  { path: DEFAULT_ROUTE, label: "Übersicht", Component: OverviewPage },
  { path: "/printers", label: "Drucker", Component: PrintersPage },
  { path: "/knowledge", label: "Wissensbasis", Component: KnowledgePage },
  { path: "/chat", label: "Assistent", Component: AssistantPage },
  { path: "/settings", label: "Einstellungen", Component: SettingsPage },
] as const satisfies readonly AppRoute[];

export function getNavigationClassName(isActive: boolean): string {
  return isActive ? "navigation-link navigation-link-active" : "navigation-link";
}
