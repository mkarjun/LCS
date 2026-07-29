import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import { SERVICE_CATALOG, servicePath } from "./catalog";
import type { CatalogEntry } from "./catalog";

/**
 * Services with a purpose-built console surface.
 *
 * Keyed by route path. Everything else in the catalog still gets a route and a page —
 * see ServicePlaceholderPage — so no service dead-ends, which is the point of building
 * the full skeleton before the per-service UIs.
 *
 * Each module is code-split, so a service's screens download only when visited.
 *
 * Boundary rule: a service module may import from `shell/` and `platform/`, never from
 * a sibling service.
 */
export const IMPLEMENTED_SERVICES: Record<string, LazyExoticComponent<ComponentType>> = {
  s3: lazy(() => import("./s3/S3Routes")),
  ec2: lazy(() => import("./ec2/Ec2Routes")),
  iam: lazy(() => import("./iam/IamRoutes")),
  lambda: lazy(() => import("./lambda/LambdaRoutes")),
  // AWS presents Logs and Metrics as one CloudWatch console, so both catalog entries
  // (`logs` and `monitoring`) resolve to the same module.
  cloudwatch: lazy(() => import("./cloudwatch/CloudWatchRoutes")),
  "cloudwatch-logs": lazy(() => import("./cloudwatch/CloudWatchRoutes")),
  dynamodb: lazy(() => import("./dynamodb/DynamoDbRoutes")),
  sqs: lazy(() => import("./sqs/SqsRoutes")),
  sns: lazy(() => import("./sns/SnsRoutes")),
  rds: lazy(() => import("./rds/RdsRoutes")),
  cloudformation: lazy(() => import("./cloudformation/CloudFormationRoutes")),
};

export function isImplemented(entry: CatalogEntry): boolean {
  return servicePath(entry) in IMPLEMENTED_SERVICES;
}

export function implementedCount(): number {
  return SERVICE_CATALOG.filter(isImplemented).length;
}
