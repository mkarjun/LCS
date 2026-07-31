import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import "@cloudscape-design/global-styles/index.css";
import "./index.css";

import { App } from "./App";
import { EmulatorProvider } from "@platform/EmulatorContext";
import { BreadcrumbProvider } from "@shell/BreadcrumbContext";
import { NotificationProvider } from "@shell/NotificationContext";
import { ServiceNavProvider } from "@shell/ServiceNavContext";
import { applyVisualMode, watchBrowserMode } from "@shell/theme";

// Apply the saved visual-mode preference (browser / light / dark) and keep "browser" mode
// tracking the OS theme.
applyVisualMode();
watchBrowserMode();

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
