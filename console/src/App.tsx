import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { IMPLEMENTED_SERVICES } from "@services/registry";
import { AppShell } from "@shell/AppShell";
import { AllServicesPage } from "@shell/AllServicesPage";
import { HomePage } from "@shell/HomePage";
import { NotFoundPage } from "@shell/NotFoundPage";
import ServicePlaceholderPage from "@shell/ServicePlaceholderPage";

// CloudShell is a full-page terminal, not a normal catalog service, so it gets its own
// top-level route rather than living in the service registry.
const CloudShellPage = lazy(() => import("@services/cloudshell/CloudShellPage"));

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="services" element={<AllServicesPage />} />
        <Route path="cloudshell" element={<CloudShellPage />} />

        {/* Services with a purpose-built console own their whole subtree. */}
        {Object.entries(IMPLEMENTED_SERVICES).map(([path, ServiceComponent]) => (
          <Route key={path} path={`${path}/*`} element={<ServiceComponent />} />
        ))}

        {/*
          Every remaining catalog service resolves here, so nothing in navigation or
          search dead-ends. The page itself renders not-found for a path that is not a
          known service, which keeps unknown URLs honest.
        */}
        <Route path=":servicePath" element={<ServicePlaceholderPage />} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
