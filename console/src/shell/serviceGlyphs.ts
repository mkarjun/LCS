/**
 * Service glyphs.
 *
 * These are original artwork, deliberately NOT the AWS Architecture Icons. Those are
 * licensed separately from the SDKs and Cloudscape (Apache 2.0), and their terms restrict
 * redistribution and modification — shipping them inside a third-party emulator would be
 * a trademark and licensing problem.
 *
 * Each glyph is a generic pictogram of what the service *does* (a bucket for object
 * storage, a cylinder for a database, a queue for messaging), drawn on a 24x24 grid and
 * stroked in white over the category colour. Every service resolves to a real pictogram:
 * a service-specific one where it exists, otherwise its category's, so nothing falls back
 * to bare initials.
 */

import type { ServiceCategory } from "@services/catalog";

/** Paths are drawn on a 24x24 viewBox and stroked, not filled. */
export const GLYPH_STROKE_WIDTH = 1.7;

const SERVER = "M4 5h16v5H4z M4 14h16v5H4z M7 7.5h.01 M7 16.5h.01";
const BUCKET = "M4 7h16l-1.6 12H5.6z M4 7c0-1.5 3.6-2.5 8-2.5S20 5.5 20 7";
const DATABASE = "M12 3c4.4 0 8 1.2 8 2.7v12.6c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7V5.7C4 4.2 7.6 3 12 3z M20 9.5c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7 M20 15c0 1.5-3.6 2.7-8 2.7s-8-1.2-8-2.7";
const SHIELD = "M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z";
const KEY = "M14.5 4a5.5 5.5 0 1 0-4.3 8.9L4 19v2h3v-2h2v-2h2l1.4-1.4A5.5 5.5 0 0 0 14.5 4z M16 8h.01";
const LAMBDA = "M5 20l6.5-16h2L20 20h-3l-4.5-11L8 20z";
const QUEUE = "M3 6h18 M3 12h18 M3 18h12 M17.5 18h.01 M20.5 18h.01";
const BELL = "M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6a6 6 0 0 0-6-6z M10 19a2 2 0 0 0 4 0";
const LOGS = "M6 3h9l4 4v14H6z M15 3v4h4 M9 12h7 M9 16h7 M9 8h3";
const CHART = "M4 20V4 M4 20h16 M8 17v-5 M12 17V8 M16 17v-8";
const NETWORK = "M12 3v5 M12 16v5 M4.5 12h5 M14.5 12h5 M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0 M12 3m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0 M12 21m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0";
const GLOBE = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c2.5 2.4 3.8 5.6 3.8 9S14.5 18.6 12 21 M12 3C9.5 5.4 8.2 8.6 8.2 12S9.5 18.6 12 21";
const CONTAINER = "M3 8.5l9-4.5 9 4.5v7l-9 4.5-9-4.5z M3 8.5l9 4.5 9-4.5 M12 13v7";
const STACK = "M12 3l9 4.5-9 4.5-9-4.5z M3 12l9 4.5 9-4.5 M3 16.5L12 21l9-4.5";
const GATEWAY = "M4 12h5 M15 12h5 M9 6h6v12H9z M12 9v6";
const SCALE = "M12 4v16 M6 8l6-4 6 4 M6 16l6 4 6-4 M3 12h4 M17 12h4";
const BALANCER = "M12 4v6 M12 10L6 14 M12 10l6 4 M4 14h4v6H4z M10 14h4v6h-4z M16 14h4v6h-4z";
const WORKFLOW = "M5 4h5v5H5z M14 15h5v5h-5z M7.5 9v6h9 M14 15l2.5-2.5";
const STREAM = "M4 7c4-2 6 2 10 0s4-2 6-1 M4 13c4-2 6 2 10 0s4-2 6-1 M4 19c4-2 6 2 10 0s4-2 6-1";
const MAIL = "M3 6h18v12H3z M3 6l9 7 9-7";
const CODE = "M9 7l-5 5 5 5 M15 7l5 5-5 5";
const CLOCK = "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3.5 2";
const CACHE = "M4 6h16v4H4z M4 14h16v4H4z M7 8h.01 M7 16h.01 M11 8h6 M11 16h6";
const SEARCH = "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16.5 16.5L21 21";
const DOCUMENT = "M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6";
const BRAIN = "M9 4a3 3 0 0 0-3 3 3 3 0 0 0-1 5.8V15a3 3 0 0 0 4 2.8V20 M15 4a3 3 0 0 1 3 3 3 3 0 0 1 1 5.8V15a3 3 0 0 1-4 2.8V20 M12 4v16";
const MONEY = "M12 3v18 M16 7.5c0-1.7-1.8-2.5-4-2.5s-4 .8-4 2.5S10 10 12 10s4 1 4 2.8-1.8 2.7-4 2.7-4-1-4-2.7";
const LOCK = "M6 11h12v9H6z M9 11V7.5a3 3 0 0 1 6 0V11 M12 15v2";
const TRANSFER = "M4 8h13 M14 5l3 3-3 3 M20 16H7 M10 13l-3 3 3 3";
const BUILD = "M14.5 4.5a4 4 0 0 0-5.3 5.3L4 15v5h5l5.2-5.2a4 4 0 0 0 5.3-5.3l-3 3-2-2z";
const IOT = "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M8.5 8.5a5 5 0 0 0 0 7 M15.5 8.5a5 5 0 0 1 0 7 M6 6a9 9 0 0 0 0 12 M18 6a9 9 0 0 1 0 12";
const GRAPH = "M6 6m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M18 8m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M9 18m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0 M8 7.2L15.5 8 M7.4 8.3l1.2 7.3";
const GRAPHQL = "M12 3l8 4.5v9L12 21l-8-4.5v-9z M12 3v18 M4 7.5l16 9 M20 7.5l-16 9";

/** Per-service pictograms, keyed by the emulator's service id. */
const SERVICE_GLYPHS: Record<string, string> = {
  s3: BUCKET,
  s3vectors: BUCKET,
  ec2: SERVER,
  lightsail: SERVER,
  batch: SERVER,
  elasticbeanstalk: STACK,
  lambda: LAMBDA,
  iam: SHIELD,
  kms: KEY,
  secretsmanager: LOCK,
  acm: LOCK,
  wafv2: SHIELD,
  cognito: SHIELD,
  "cognito-idp": SHIELD,
  dynamodb: DATABASE,
  rds: DATABASE,
  "rds-data": DATABASE,
  docdb: DATABASE,
  memorydb: CACHE,
  elasticache: CACHE,
  neptune: GRAPH,
  sqs: QUEUE,
  sns: BELL,
  mq: QUEUE,
  events: STREAM,
  pipes: STREAM,
  scheduler: CLOCK,
  kinesis: STREAM,
  firehose: STREAM,
  kafka: STREAM,
  logs: LOGS,
  monitoring: CHART,
  cloudtrail: LOGS,
  config: DOCUMENT,
  cloudformation: STACK,
  cloudcontrol: STACK,
  ssm: BUILD,
  backup: DOCUMENT,
  tagging: DOCUMENT,
  apigateway: GATEWAY,
  apigatewayv2: GATEWAY,
  appsync: GRAPHQL,
  states: WORKFLOW,
  ecs: CONTAINER,
  eks: CONTAINER,
  ecr: CONTAINER,
  autoscaling: SCALE,
  elasticloadbalancing: BALANCER,
  route53: GLOBE,
  cloudfront: GLOBE,
  servicediscovery: NETWORK,
  athena: SEARCH,
  es: SEARCH,
  glue: BUILD,
  elasticmapreduce: CHART,
  email: MAIL,
  codebuild: CODE,
  codedeploy: CODE,
  codepipeline: WORKFLOW,
  textract: DOCUMENT,
  transcribe: BRAIN,
  "bedrock-runtime": BRAIN,
  iot: IOT,
  iotdata: IOT,
  transfer: TRANSFER,
  ce: MONEY,
  cur: MONEY,
  pricing: MONEY,
  "bcm-data-exports": MONEY,
  appconfig: DOCUMENT,
  appconfigdata: DOCUMENT,
};

/** Fallback pictogram per category, so every service gets a real icon. */
const CATEGORY_GLYPHS: Record<ServiceCategory, string> = {
  Analytics: CHART,
  "Application Integration": QUEUE,
  "Business Applications": MAIL,
  "Cloud Financial Management": MONEY,
  Compute: SERVER,
  Containers: CONTAINER,
  Database: DATABASE,
  "Developer Tools": CODE,
  "Front-end Web & Mobile": GATEWAY,
  "Machine Learning": BRAIN,
  "Management & Governance": DOCUMENT,
  "Networking & Content Delivery": NETWORK,
  "Security, Identity, & Compliance": SHIELD,
  Storage: BUCKET,
};

/** AWS's own category colours, so the palette matches the console users know. */
export const CATEGORY_COLORS: Record<ServiceCategory, string> = {
  Analytics: "#8C4FFF",
  "Application Integration": "#E7157B",
  "Business Applications": "#DD344C",
  "Cloud Financial Management": "#00A4A6",
  Compute: "#ED7100",
  Containers: "#ED7100",
  Database: "#2E27AD",
  "Developer Tools": "#3334B9",
  "Front-end Web & Mobile": "#E7157B",
  "Machine Learning": "#01A88D",
  "Management & Governance": "#E7157B",
  "Networking & Content Delivery": "#8C4FFF",
  "Security, Identity, & Compliance": "#DD344C",
  Storage: "#7AA116",
};

export function glyphFor(serviceId: string, category: ServiceCategory): string {
  return SERVICE_GLYPHS[serviceId] ?? CATEGORY_GLYPHS[category];
}
