import type { ReactNode } from "react";
import { RecentlyVisitedWidget } from "./RecentlyVisitedWidget";
import { ServiceHealthWidget } from "./ServiceHealthWidget";
import { EnvironmentWidget } from "./EnvironmentWidget";
import { GettingStartedWidget } from "./GettingStartedWidget";
import { ConsoleCoverageWidget } from "./ConsoleCoverageWidget";

/**
 * Console home widgets.
 *
 * The AWS console home is a customizable board: drag to rearrange, resize, add and
 * remove widgets, reset to a default layout. That interaction model is reproduced here
 * with Cloudscape's board components — the same ones AWS builds it from.
 *
 * The widget *content* is LCS-appropriate rather than copied. AWS's "Cost and usage",
 * "AWS Health", and "Applications" widgets report on a real account; inventing local
 * equivalents would fabricate data. What LCS genuinely knows — which services are
 * running, what the endpoint is, what has a console surface — is surfaced instead.
 */
export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  /** Default board footprint, in Cloudscape board grid units (4 columns). */
  defaultColumnSpan: number;
  defaultRowSpan: number;
  content: ReactNode;
}

export const WIDGET_DEFINITIONS: WidgetDefinition[] = [
  {
    id: "recently-visited",
    title: "Recently visited",
    description: "Services you opened most recently.",
    defaultColumnSpan: 2,
    defaultRowSpan: 4,
    content: <RecentlyVisitedWidget />,
  },
  {
    id: "service-health",
    title: "Emulator health",
    description: "Which emulated services are currently running.",
    defaultColumnSpan: 2,
    defaultRowSpan: 4,
    content: <ServiceHealthWidget />,
  },
  {
    id: "environment",
    title: "Environment",
    description: "Endpoint, region, account, and version.",
    defaultColumnSpan: 2,
    defaultRowSpan: 3,
    content: <EnvironmentWidget />,
  },
  {
    id: "getting-started",
    title: "Getting started",
    description: "Connect the AWS CLI and SDKs to LCS.",
    defaultColumnSpan: 2,
    defaultRowSpan: 3,
    content: <GettingStartedWidget />,
  },
  {
    id: "console-coverage",
    title: "Console coverage",
    description: "How many services have a console surface.",
    defaultColumnSpan: 2,
    defaultRowSpan: 3,
    content: <ConsoleCoverageWidget />,
  },
];

/** Widgets shown on a first visit, before the user customizes the board. */
export const DEFAULT_WIDGET_IDS = [
  "recently-visited",
  "service-health",
  "environment",
  "getting-started",
];

export function findWidget(id: string): WidgetDefinition | undefined {
  return WIDGET_DEFINITIONS.find((widget) => widget.id === id);
}
