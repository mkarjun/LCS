import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
import { recordVisit } from "@shell/recentlyVisited";
import { useServiceNav } from "@shell/ServiceNavContext";
import FunctionsPage from "./FunctionsPage";
import FunctionDetailPage from "./FunctionDetailPage";

/**
 * Lambda routes and navigation.
 *
 * Applications and Function URLs are omitted: ListFunctionUrlConfigs and
 * GetAccountSettings return UnsupportedOperation on this build, verified by probe.
 */
export default function LambdaRoutes() {
  useEffect(() => recordVisit("lambda"), []);

  useServiceNav({
    title: "AWS Lambda",
    href: "/lambda",
    items: [
      { type: "link", text: "Functions", href: "/lambda" },
      { type: "link", text: "Layers", href: "/lambda/layers" },
    ],
  });

  return (
    <Routes>
      <Route index element={<FunctionsPage />} />
      <Route path="functions/:functionName" element={<FunctionDetailPage />} />
      <Route path="layers" element={<FunctionsPage layersView />} />
    </Routes>
  );
}
