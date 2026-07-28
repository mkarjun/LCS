import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "@cloudscape-design/global-styles/index.css";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import "./index.css";

import { App } from "./App";
import { EmulatorProvider } from "@platform/EmulatorContext";
import { BreadcrumbProvider } from "@shell/BreadcrumbContext";
import { NotificationProvider } from "@shell/NotificationContext";
import { ServiceNavProvider } from "@shell/ServiceNavContext";

// Follow the OS theme, and keep following it if the user changes it mid-session.
const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
const syncMode = (matches: boolean) => applyMode(matches ? Mode.Dark : Mode.Light);
syncMode(darkMode.matches);
darkMode.addEventListener("change", (event) => syncMode(event.matches));

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Console root element is missing");
}

createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename="/_lcs/ui">
      <EmulatorProvider>
        <NotificationProvider>
          <BreadcrumbProvider>
            <ServiceNavProvider>
              <App />
            </ServiceNavProvider>
          </BreadcrumbProvider>
        </NotificationProvider>
      </EmulatorProvider>
    </BrowserRouter>
  </StrictMode>,
);
