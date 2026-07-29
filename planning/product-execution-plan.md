# LCS Product Execution Plan

Research-backed execution plan covering console parity, the edge router, end-to-end
coverage, and frontend architecture.

Status: Phase 0 decisions accepted; **Phase 1 in progress** — see
[Implementation Log](#implementation-log) at the end for what is actually built.

Scope note: this plan is AWS-first. Azure and GCP are explicitly deferred, but every
structural decision below is checked against "does this survive a second provider".

---

## Findings That Change The Plan

Four research findings materially change what we should build. Read these first;
the phases afterwards depend on them.

### Finding 1: The AWS console is built on an open-source design system we can just use

The AWS Management Console is built with **Cloudscape Design System**, which AWS
open-sourced in 2022 under **Apache 2.0**.

- npm: `@cloudscape-design/components`, `@cloudscape-design/global-styles`
- React component library: 60+ components, 30+ documented pattern guidelines, 20+ demos
- Includes the exact primitives the console is made of: `AppLayout`, `Table`,
  `SideNavigation`, `BreadcrumbGroup`, `Flashbar`, `KeyValuePairs`, `Wizard`,
  `SplitPanel`, `PropertyFilter`, `Cards`, `ColumnLayout`, `Tabs`
- Ships AWS's real design tokens, spacing, density modes, dark mode, and accessibility behavior

This means **we do not need to reverse-engineer the AWS console's look**. We adopt the
same library AWS uses and we get pixel-level fidelity, dark mode, responsive behavior,
and accessibility for free — legally, and without guessing.

This directly satisfies the `aws-console-parity.md` requirement of "match AWS
information density / table behavior / hierarchy" by construction rather than by
eyeballing.

The documented Cloudscape *patterns* also give us the behavioral spec we were going to
have to derive manually:

| Pattern | What it pins down |
|---|---|
| Table view | Header counter, global actions, text filter, pagination vs progressive loading, preferences (rows per page, column visibility/order), empty vs zero-results vs error states, selection reset rules |
| Details page | Breadcrumbs → title → header actions → summary container → related resources; key-value pairs in containers; nav open by default; containers capped at ~10 items before switching to hub pattern |
| Split view | Table + collapsible detail side panel |
| Create resource | Single-page create vs wizard; sub-resource creation inline (roles, policies, security groups) |
| Page edit | Edit-in-place flow shape |

### Finding 2: Live-scraping the AWS console does not work

I logged into your AWS account and loaded the EC2 Instances and IAM Users consoles
successfully — but **the browser extension cannot inject scripts into the AWS console**.
Screenshots and DOM reads both fail (`Script injection timed out`, `executeScript waited
45000ms`). AWS ships a strict Content-Security-Policy that blocks this.

Consequence: an automated "crawl the AWS console and diff it against ours" pipeline is
not viable. Substitute plan:

- **Primary spec source:** Cloudscape docs + demos (machine-readable, versioned, precise)
- **Evidence for the parity rubric:** manual side-by-side screenshots, captured by you,
  stored per service in `planning/services/<svc>/evidence/`
- **Behavioral spec source:** AWS service docs + the Cloudscape pattern pages

This is a better source than screenshots anyway — Cloudscape gives exact token values,
not pixels we have to guess at.

### Finding 3: The current console architecture will not scale to AWS parity

Current state:

| Layer | Implementation | Size |
|---|---|---|
| UI shell | Hand-written HTML | `index.html` |
| Styling | Hand-written CSS | 1,299 lines |
| Behavior | Vanilla JS, no framework, no build step | 1,526 lines |
| Page model | Java records built server-side (`ConsoleServicePage`, `ConsoleMetric`, `ConsoleTable`, `ConsoleAction`, `ConsoleField`, `ConsoleDetailPane`) | `ConsoleServiceApplication.java`, 2,715 lines |

The blocking problem is the **server-driven generic page model**. The console renders
whatever generic `metrics/tables/actions/detailPanes` descriptors Java hands it. That
model cannot express what AWS actually does — the EC2 launch wizard, the S3 bucket
permissions editor, the IAM policy visual editor, the Step Functions graph. Every new
service either flattens into generic tables or forces a new descriptor type into a
shared Java model, which is exactly the "generic dashboard widgets" the parity rubric
forbids.

It also creates a permanent second implementation of business logic: `ConsoleServiceApplication`
calls `Ec2Service`, `IamService`, `S3Service` etc. *directly in-process*. That is 2,715
lines of Java that duplicates what the AWS APIs already expose, drifts from them, and
**breaks entirely under the microservices split** (Finding 4).

### Finding 4: The console's in-process service calls are incompatible with the edge-router plan

`ConsoleServiceApplication` injects `Ec2Service`, `IamService`, `S3Service`,
`LambdaService`, `DynamoDbService`, `SqsService`, `SnsService`, `ElbV2Service` as CDI
beans. When EC2 and IAM become separate processes, those injections stop resolving. The
console layer would have to be rewritten as HTTP calls anyway.

**So the console rewrite and the microservices split are the same problem, and doing the
console rewrite first de-risks the split.**

---

## The Core Architectural Recommendation

**Make the LCS console a browser-side React app that talks to LCS through the AWS SDK for
JavaScript v3 — exactly the way the real AWS console talks to AWS.**

```
Browser (React + Cloudscape + @aws-sdk/client-*)
        │  standard AWS wire protocol, SigV4, port 4566
        ▼
   LCS edge / monolith  ──►  services
```

Instead of:

```
Browser (vanilla JS)
        │  bespoke /_lcs/console/* JSON
        ▼
ConsoleServiceApplication (2,715 lines of Java)
        │  in-process CDI calls
        ▼
   services
```

Why this is the right call:

1. **It deletes the drift.** No parallel Java UI model to keep in sync with the API.
   `ConsoleServiceApplication` and `ConsoleServiceController` go away (~3,100 lines).
2. **The console becomes a compatibility test.** Every console click is a real SDK call
   over the real wire protocol. If the console works, the SDK path works. This is free
   E2E coverage of exactly the thing the project cares most about.
3. **It survives the microservices split unchanged.** The browser hits `:4566`; the edge
   routes. The console does not care how many processes are behind it.
4. **It survives Azure/GCP.** Provider-scoped console modules, each using that provider's
   browser SDK. Same shell, same shape.
5. **It is what AWS does**, so parity stops being an act of imitation and becomes an act
   of using the same inputs.

Tradeoffs to accept:

- Requires a **build step** (Vite/npm) producing static assets into
  `src/main/resources/META-INF/resources/`. New CI dependency on Node.
- Requires **CORS** on port 4566 for browser-origin AWS SDK calls, plus browser-side
  SigV4 (fine — credentials are `test`/`test`, non-secret by design).
- Larger asset payload than the current vanilla JS. Mitigated by per-service code
  splitting; irrelevant for a local tool.
- A one-time rewrite cost that throws away working code. This is the main argument
  against, and it is real — but that code blocks both parity and the split.

**Decision required from you before Phase 1 starts.** Everything downstream assumes yes.

---

## Answers To Your Four Questions

### 1. Replicating the AWS UI → adopt Cloudscape, don't reimplement it

Covered in Finding 1. The plan is *use AWS's own component library*, not clone its
output. Live console scraping is blocked (Finding 2); Cloudscape docs are the spec.

### 2. Edge router → build the classifier first, inside the monolith

Detailed design in Phase 2 below. The key move: **the hard part of the edge router is
request classification, not proxying** — and classification can be built and fully
validated *before* any process split, as a library inside the current monolith.

### 3. E2E + service/UI coverage gap → 7 of 52 services have real UIs

Measured gap:

| | Count |
|---|---|
| Service packages in `services/` | **52** |
| Services with a bespoke console page | **7** — `ec2`, `iam`, `s3`, `lambda`, `dynamodb`, `sqs`, `sns` |
| Services falling through to `buildGenericPage` | **45** |

Existing test assets (strong — this is a real asset, not a gap):

| Suite | Count |
|---|---|
| `src/test` total | 320 test classes (161 `*IntegrationTest`) |
| Compatibility suite | 1,968 tests across Java/Node/Python/Go/Rust/CLI + Terraform/OpenTofu/CDK |
| Console tests | **1** (`ConsoleControllerIntegrationTest`) |

So: API coverage is genuinely strong; **console coverage is effectively zero**. Plan in
Phase 3.

Also flagging a scope problem: the current checklist mandates **30 business scenarios per
service × 52 services = 1,560 scenarios**, each requiring API parity + console parity +
evidence. That is not achievable at a sustainable pace and will stall the project.
Recommendation: tier it (Phase 0).

### 4. Should the frontend be microservice-modular too? → **No. Modular code, single deployable.**

Research is consistent and the reasoning applies cleanly here:

- Micro-frontends solve an **organizational** problem — independent teams shipping on
  independent release cadences. You are one team shipping one artifact. Federation would
  add runtime failure modes without removing any release bottleneck.
- Concrete costs you'd take on: shared-dependency version skew across remotes, no CSS
  isolation by default, harder cross-boundary debugging, build-tool lock-in, non-atomic
  releases needing their own rollback procedure.
- LCS ships as **one Docker image the user runs locally**. Independent frontend
  deployability has no user-visible benefit — there is no scenario where a user upgrades
  the S3 console without upgrading LCS.
- The backend split is driven by process isolation and Docker-socket blast radius. None
  of those forces act on the frontend.

**Do instead:** one React app, hard module boundaries per service, route-level code
splitting.

```
console/src/
  shell/                 AppLayout, nav, region/account switcher, flashbar host
  platform/              SDK client factory, auth, error mapping, shared hooks
  services/
    ec2/                 owns its routes, screens, SDK calls — imports nothing from siblings
    s3/
    iam/
    <service>/
  registry.ts            service → lazy-loaded module manifest
```

Rules that give you the benefits without the cost:
- A service module may import from `shell/` and `platform/`, never from a sibling service.
- Each service module registers itself in `registry.ts`; the shell knows nothing about
  any specific service.
- `React.lazy` per service module → each service is its own chunk, loaded on navigation.
- Enforce the boundary in CI with an import-linter rule, not by convention.

This gives ownership isolation, independent testability, per-service lazy loading, and a
clean seam **if** you ever genuinely need federation later. Revisit only if multiple
independent teams start shipping consoles on separate cadences.

Provider scoping for Azure/GCP later: `services/` becomes `providers/aws/services/`,
`providers/azure/services/`. The shell and platform layers stay shared.

---

## Execution Phases

### Phase 0 — Decisions and scope correction

No code. Unblocks everything else.

1. **Decide on the console architecture recommendation above.** Yes/no. Everything
   downstream branches here.
2. **Tier the services.** Replace flat "30 scenarios × 52 services" with:

   | Tier | Services | Console bar | Scenario pack |
   |---|---|---|---|
   | **T1 — Deep parity** | EC2, S3, IAM, Lambda, DynamoDB, SQS, SNS, CloudWatch Logs, CloudFormation, RDS | Full AWS parity: inventory + detail + create/edit/delete flows | 30 |
   | **T2 — Functional** | ~15 commonly-taught services (STS, KMS, Secrets Manager, EventBridge, Step Functions, API Gateway v1/v2, ECS, ECR, Kinesis, SSM, Cognito, ELBv2, Route53, Firehose) | Inventory + detail + primary create flow | 10 |
   | **T3 — Inventory only** | Remaining ~27 | Read-only list + detail, honest "managed via API/CLI" empty state | 3 (smoke) |

   Rationale: matches your stated audience (learners, developers, on-prem first-tests) and
   matches how AWS itself weights console investment. T1 is 300 scenarios instead of 1,560.
3. **Freeze the routing contract** — write `planning/edge-contract.md` (this closes the
   open Phase 0 checklist item "Define edge-router contract"). Content specified in Phase 2.
4. **Set the parity evidence workflow** — where side-by-side screenshots live, naming, and
   what counts as "matches".

Exit gate: decisions recorded in `planning/master-checklist.md`; tiering reflected in the
service coverage section.

---

### Phase 1 — Console foundation

Goal: a Cloudscape shell that talks to LCS via the AWS JS SDK, with one service ported
end to end as the reference implementation.

1. **Add the build.** `console/` at repo root: Vite + React + TypeScript +
   `@cloudscape-design/components`. Build output → `src/main/resources/META-INF/resources/`.
   Wire into Maven (`frontend-maven-plugin` or a profile) so `mvnw package` produces a
   complete image. Keep the build skippable for backend-only iteration.
2. **Enable browser SDK access.** CORS on `:4566` for console origin; verify SigV4 from
   browser against S3, EC2 (Query), and DynamoDB (JSON 1.1) — one service per protocol
   family, to prove all three wire formats work from a browser.
3. **Build the shell.** Cloudscape `AppLayout` + `SideNavigation` + `BreadcrumbGroup` +
   `Flashbar` + `TopNavigation`. Region and account switcher backed by real config.
   Service registry with lazy-loaded modules. LCS branding at shell level only — the
   parity rubric requires service task wording to stay AWS-native.
4. **Port S3 as the reference module.** Chosen because it is REST XML (the awkward
   protocol — proves the hard case), high learner value, and the AWS S3 console is
   well-documented. Deliver: bucket table view (filter, pagination, preferences, empty
   states), bucket detail page with tabs, object browser, create-bucket flow, upload,
   delete with AWS-shaped confirmation.
5. **Establish the parity evidence loop** on S3: side-by-side screenshots vs the real
   console for each screen, stored under `planning/services/s3/evidence/`.

Exit gate: S3 console fully usable, driven only by `@aws-sdk/client-s3` against `:4566`;
parity evidence captured; existing compatibility suites still green.

Deliberately deferred: do **not** delete `ConsoleServiceApplication` yet. Run the new
console at a new path alongside the old one until T1 services are ported, then delete in
one commit.

---

### Phase 2 — Edge router

Goal: protocol-aware routing, validated before any process split.

**Step 2a — Build the classifier as a library inside the monolith (highest value, lowest risk).**

`AwsRequestClassifier.classify(method, host, path, headers, queryParams) -> ServiceKey`

Signal precedence (derived from `S3VirtualHostFilter`, which already solves this problem
correctly for S3 and is the working reference):

| # | Signal | Source | Notes |
|---|---|---|---|
| 1 | SigV4 credential scope | `Authorization: AWS4-HMAC-SHA256 Credential=.../<region>/<service>/aws4_request` | Most reliable. Covers all signed requests. |
| 2 | Presigned scope | `X-Amz-Credential` query param | Same scope format, unsigned-header requests |
| 3 | `X-Amz-Target` prefix | header | JSON 1.1 services; map prefix → service |
| 4 | Virtual-host bucket label | `Host` | S3; reuse `extractBucket` logic verbatim |
| 5 | Path prefix | path | REST JSON/XML: `/2015-03-31/functions/*` → Lambda, etc. |
| 6 | `Action=` form field | body | Query protocol, unsigned only — **last resort** |

Critical constraints, learned from `S3VirtualHostFilter`:

- **Never buffer the body to classify** unless signals 1–5 all failed *and*
  `Content-Length` is small. S3 streams multi-GB objects; buffering breaks them.
  `S3VirtualHostFilter` already avoids this by discriminating on `Content-Type`
  (`x-www-form-urlencoded` / `x-amz-json-` are never S3).
- **Never modify request bytes or the `Host` header.** SigV4 signs headers plus payload
  hash; any rewrite invalidates the signature downstream. Note the compose draft currently
  sets `FLOCI_AUTH_VALIDATE_SIGNATURES: "false"` — that is a shortcut that must be
  resolved, not inherited.
- Handle `aws-chunked` / `STREAMING-AWS4-HMAC-SHA256-PAYLOAD` as opaque passthrough.
- Ambiguous pairs need explicit tests: SQS vs SNS (both Query), CloudWatch Metrics (both
  Query *and* JSON 1.1 — `AGENT.md` calls this out), S3 vs S3 Control (`/v20180820/`),
  Cognito OIDC well-known endpoints (not management API).

**Step 2b — Validate classification against the existing 1,968-test corpus.**

Add a request-capture filter to the monolith. Run the full compatibility suite. Assert the
classifier's answer matches the service that actually handled each request. This gives a
near-exhaustive, real-traffic correctness proof of the routing table **before writing any
proxy**. This is the single highest-leverage step in the whole edge-router effort.

**Step 2c — Implement the edge process.**

Quarkus + Vert.x reverse proxy, in this repo, reusing the classifier and generating its
service→node map from the same `ServiceRegistry` the monolith uses (single source of truth).

Not nginx/Envoy: routing needs AWS-protocol awareness (`X-Amz-Target` mapping, `Action=`
fallback, virtual-host bucket extraction) that config-driven proxies cannot express, and
the mapping must not drift from `ServiceRegistry`.

Must also handle:
- Console + `/_lcs/health` + `/_lcs/console/*` served directly by edge
- Aggregated health across nodes
- WebSocket passthrough (Neptune Gremlin, 8182)
- **Raw TCP services (RDS, ElastiCache) cannot traverse an HTTP edge** — these keep direct
  host port exposure. Document as an explicit architectural exception.
- Internal request context headers: account ID, region, request ID, caller identity

**Step 2d — Phase-1 topology.**

Bring up `edge` + `iam` + `s3` + `ec2` per `docker-compose.microservices.yml`. Run the full
compatibility suite against the edge. **The monolith remains the oracle** — identical
results required, per the existing Phase 0 rule.

Exit gate: full compatibility suite passes against the 4-node topology with results
identical to the monolith.

---

### Phase 3 — End-to-end coverage

**3a — Console E2E (the actual gap).** Playwright against a real LCS container.
Per T1 service: inventory loads, create flow, detail drill-in, edit, delete, empty state,
error state. Because the console uses the AWS SDK, each test transitively validates the
wire protocol.

**3b — Console↔API state assertions.** The parity rubric requires "executable validation
proving the console action matches API state". Pattern: perform the action in the browser,
then assert via CLI/SDK out-of-band. Codify as a shared helper.

**3c — Close the service/UI gap.** Drive the 45 uncovered services to their tier bar.
T3's honest read-only inventory page is a legitimate finish state — the rubric explicitly
says not to invent console surfaces AWS doesn't have.

**3d — Cross-service business flows.** The scenario packs' real value. Examples: launch
EC2 with an instance profile (EC2+IAM+STS); S3 event → Lambda → DynamoDB; SQS DLQ
redrive. These are what learners and on-prem evaluators actually try, and they are where
emulators usually break.

**3e — CI wiring.** Compatibility suites + console E2E on PR; full matrix nightly.

---

### Phase 4 — Consolidation

1. Delete `ConsoleServiceApplication`, `ConsoleServiceController`, and the legacy
   vanilla-JS console once T1+T2 are ported (~3,100 lines of Java plus 2,800 lines of
   JS/CSS removed).
2. Resume the LCS rebrand at Phase C/D per `docs/configuration/lcs-rebrand.md` — runtime
   artifact names, then internal package rename, in validation waves.
3. Only then evaluate the Azure provider module, against a console shell and an edge
   router that have both already proven they generalize.

---

## Sequencing Rationale

```
Phase 0  decisions
   │
   ├──► Phase 1  console foundation (S3 reference)   ─┐
   │                                                  ├──► Phase 3  E2E
   └──► Phase 2  edge router (classifier first)      ─┘
                                                          │
                                                          ▼
                                                     Phase 4  consolidation → Azure
```

Phases 1 and 2 are **independent and parallelizable** — one is frontend, the other is
request routing. They converge at Phase 3.

Ordering arguments:
- Console before mass service coverage: porting 52 services onto an architecture we're
  about to replace is wasted work.
- Classifier before proxy: 1,968 existing tests can validate routing for free, before any
  process-split risk is taken on.
- Rebrand last: it is cosmetic relative to these, and `lcs-rebrand.md` already correctly
  says the internal rename must come after compatibility layers are proven.

---

## Open Questions

1. **Console architecture** — adopt the browser-SDK + Cloudscape recommendation? (blocks Phase 1)
2. **Tiering** — is the T1/T2/T3 split the right shape for the learner + on-prem audience?
3. **Node in the build** — acceptable to add npm/Vite to the Maven build and CI?
4. **Signature validation at the edge** — must the edge validate SigV4, or is
   validate-at-node sufficient? (affects whether the compose draft's
   `FLOCI_AUTH_VALIDATE_SIGNATURES: "false"` can be lifted)
5. **Cloudscape branding limits** — Cloudscape is Apache 2.0 and brand-neutral, but
   confirm how far LCS branding replaces AWS visual identity in the shell.

---

## Implementation Log

### Phase 1 — console foundation (in progress)

Built and verified against a running emulator:

| Item | Status |
|---|---|
| `console/` — Vite + React + TS + Cloudscape 3.0.1335, AWS SDK v3 | Done |
| Cloudscape shell: `AppLayout`, `SideNavigation`, `BreadcrumbGroup`, `Flashbar`, `TopNavigation` | Done |
| Lazy-loaded service registry with enforced module boundaries | Done |
| Region / account (access-key) switcher | Done |
| S3: bucket table view — filter, pagination, sorting, selection, empty/zero-results/error states | Done |
| S3: create bucket with AWS naming-rule validation | Done |
| S3: delete bucket with retype-to-confirm | Done |
| S3: bucket detail — Objects and Properties tabs, object listing, upload, delete | Done |
| Maven `console` profile (`frontend-maven-plugin`, self-downloading Node) | Done |
| `.dockerignore` / `.gitignore` wiring | Done |
| `ConsoleUiRoute` — SPA fallback so deep links and refresh work | Done |
| Production image serving the console at `/_lcs/ui/` | Done, verified |
| Side-by-side AWS parity evidence capture | **Not started** |
| Playwright console E2E | **Not started** |

Verified end to end: a bucket created through the browser UI (via `@aws-sdk/client-s3`)
was immediately visible to `aws s3 ls`. That is the console↔API assertion pattern
Phase 3b calls for, working on the first service.

### Decisions made during implementation

**The console is served at `/_lcs/ui/`, not `/console/`.** Found by testing: creating a
bucket named `console-created-bucket` failed with a 404. Path-style S3 addresses buckets
at `/{bucket}/{key}`, so any bucket whose name starts with `console` would shadow the
console's own path. Bucket names must begin with a lowercase letter or digit, so a
leading-underscore prefix can never collide. This applies in production, not just dev.

**No CORS work is needed.** The plan assumed CORS on port 4566 would be required for
browser-origin SDK calls. It is not: production serves the console from LCS itself, and
dev proxies emulator traffic through Vite. Both are same-origin. Open question 4 in the
plan is therefore moot for the console; it still applies to the edge router.

**`/_lcs/console/summary` is retained** as LCS-native metadata (enabled services, default
region/account). It is not an AWS API and the console degrades gracefully without it —
status indicators are hidden, everything else still works. This matters because published
images predating `ConsoleController` do not serve it.

**`ConsoleServiceApplication` / `ConsoleServiceController` are still in place.** Per plan,
they are deleted only once T1 services are ported. The legacy console still serves `/`.

**A server-side SPA fallback is required** (`ConsoleUiRoute`). Console routes such as
`/_lcs/ui/s3` have no matching file, so without it they fall through to the S3 catch-all
and return `NoSuchBucket` — breaking deep links and page refresh. Two traps found while
building it, both now covered by `ConsoleUiRouteTest`:

- "Segment contains a dot" is *not* a valid static-asset test. Bucket names may contain
  dots, so `/_lcs/ui/s3/buckets/my.example.com` would be misread as a file. Use a
  known-extension allowlist instead.
- Vert.x routes are **not strict about trailing slashes**, so `route("/_lcs/ui")` also
  matches `/_lcs/ui/`. Redirecting without an exact-match guard sends the console's own
  entry point into an infinite redirect loop.

### Environment constraints found

- The project requires **Java 25**; this machine has JDK 20 and 8 only. Backend builds
  must go through `docker build -f docker/Dockerfile`. `./mvnw` will not work locally.
- **`.dockerignore` is allowlist-style** (`*` followed by `!` negations). New top-level
  directories need an explicit `!dir/**` entry or the build fails with "not found".
- **`package-lock.json` is globally gitignored**; `console/package-lock.json` is
  re-included via a negation so `npm ci` is reproducible.
- The published `floci/floci:latest` (v1.5.33) predates the local uncommitted
  `ConsoleController`, so it serves `/_floci/health` but not `/_lcs/console/summary`.

### Phase 1b — full console skeleton (done)

Maintainer direction: build the **complete skeleton first** — every service reachable and
navigable — then fill in each service's AWS-replica UI ("flesh and blood").

| Item | Status |
|---|---|
| `services/catalog.ts` — all 53 services, AWS display names + AWS categories | Done |
| Catalog verified against `/_lcs/console/summary`: 53/53, no missing, extra, or duplicate ids | Done |
| Side navigation — 14 AWS categories, all 53 services | Done |
| "All services" page — categorized, filterable, marks which have a console | Done |
| Global service search in the top nav, bound to **Alt+S** like AWS | Done |
| `ServicePlaceholderPage` for services without a console surface yet | Done |
| Console home rebuilt as a **customizable widget board** | Done |
| All 53 routes verified to resolve — **zero dead ends** | Done |
| Unknown paths still render not-found; deep links still work | Done |

**Console home is now a widget board**, matching the AWS console home the maintainer
supplied as reference: drag to rearrange, resize, remove via each widget's menu, "Add
widgets", and "Reset to default layout". Built on `@cloudscape-design/board-components`,
the same components AWS builds its console home from. Layout persists in localStorage and
drops unknown widget ids on load, so a stored layout can never break the page.

Widget *content* is LCS-appropriate rather than copied. AWS's "Cost and usage", "AWS
Health", and "Applications" widgets report on a real billed account; inventing local
equivalents would fabricate data and violate the "do not invent" rule. What LCS genuinely
knows is surfaced instead: Recently visited, Emulator health, Environment, Getting
started, Console coverage.

### Phase 1c — S3 rebuilt against AWS screenshots (done)

Maintainer supplied real AWS console screenshots for S3 and EC2, and chose the
**console-first, then backend-gaps** sequence. S3 was rebuilt to match.

Corrections the screenshots forced — all were wrong guesses on my part:

| Was | Now |
|---|---|
| Breadcrumb `LCS > S3 > Buckets` | `Amazon S3 > Buckets > name` — AWS has **no console-root crumb** |
| Global service nav inside a service | **Service-scoped nav** — AWS replaces the left nav with the service's own |
| Bucket table: Name, Creation date | Adds **AWS Region**, in AWS's `US East (N. Virginia) us-east-1` form |
| Plain locale timestamps | AWS's `July 28, 2026, 20:33:17 (UTC+05:30)` form |
| Actions: Delete, Create bucket | Adds **Copy ARN** and **Empty** |
| Filter "Find buckets" | "Find buckets by name" |
| Detail tabs: Objects, Properties (2 fields) | **Objects / Properties / Permissions**, fully populated |
| Object columns: Name, Size, Modified, Storage class | Adds **Type**, derived from the key extension |

New in this slice:

- `ServiceNavContext` — a service declares its own left nav; the shell falls back to the
  global catalog nav elsewhere.
- **Properties tab**, all live: Bucket overview (Region/ARN/Creation date), Bucket
  Versioning with enable/suspend, Tags, Default encryption (+ Bucket Key), Server access
  logging, Event notifications, Transfer acceleration, Object Lock, Requester pays,
  Static website hosting.
- **Permissions tab**, all live: Block public access (aggregate + four individual flags),
  Bucket policy with the "public access is blocked" alert and Copy.
- Object actions: Copy S3 URI, Copy URL, Download, Delete, Upload.
- `ConfirmBucketActionModal` — Delete requires typing the bucket name; Empty requires
  typing "permanently delete", matching AWS's destructive-action guards.

**S3 API coverage was verified by write-then-read round-trips**, not by reading docs. An
important subtlety: `GetBucketPolicy`, `GetBucketEncryption`, `GetPublicAccessBlock`,
`GetBucketWebsite`, `GetBucketLifecycle`, `GetBucketCors`, and `GetObjectLockConfiguration`
return **error codes when unset** (`NoSuchBucketPolicy`, etc.). That is correct AWS
behavior meaning "not configured" — a naive probe reads it as "not implemented". All are
in fact fully implemented.

Deliberately omitted, because LCS cannot back them — a nav item that always errors is
worse than none: Directory/Table/Vector buckets, Access Points, Access Grants, Storage
Lens, Batch Operations, Metrics and Management tabs.

### Phase 1d — EC2 console (done)

Built from the maintainer's AWS screenshots, over **verified** APIs.

| Surface | Contents |
|---|---|
| Left nav | Dashboard; Instances, Instance Types; AMIs; Volumes; Security Groups, Elastic IPs, Key Pairs, Network Interfaces |
| Dashboard | Resources counts, Launch instance, Service health with Availability Zones |
| Instances | AWS's column set, Instance state actions (start/stop/reboot/terminate), Launch instances |
| Instance detail | Summary grid + all seven tabs: Details, Status and alarms, Monitoring, Security, Networking, Storage, Tags |
| Launch wizard | Name tag, AMI, instance type, key pair, subnet, security group, count |
| Resource pages | Volumes, Security Groups, Elastic IPs, Key Pairs, Network Interfaces, AMIs, Instance Types |

**The read-only coverage probe was pessimistic.** Re-verified with write-then-read:
CreateVpc, CreateSubnet, CreateSecurityGroup, AuthorizeSecurityGroupIngress, CreateKeyPair,
CreateVolume, AllocateAddress, CreateInternetGateway, CreateRouteTable, and RunInstances
all succeed. Instances return the full detail set (type, state, IPs, DNS, VPC/subnet, AMI,
key, architecture, root device, placement, monitoring, security groups, tags, block device
mappings, network interfaces). The four absent fields — `PublicIpAddress`, `PublicDnsName`,
`IamInstanceProfile`, `StateTransitionReason` — are conditional in real AWS too.

Omitted, per `ec2-domain-coverage.md`: Launch Templates, Spot Requests, Savings Plans,
Reserved Instances, Dedicated Hosts, Capacity Reservations, Placement Groups, Snapshots,
Lifecycle Manager. Also omitted: EC2 cost and instance alarms on the dashboard, which
would require billing and health data the emulator does not produce.

#### Dev-proxy bug found by building EC2

The Vite proxy skipped the bare `/` path, so **every AWS Query-protocol service was broken
in dev** — EC2, IAM, STS, SQS, SNS, and CloudFormation all POST to the root, received
Vite's HTML, and failed with an XML parse error.

S3 hid this: its SDK appends `?x-id=ListBuckets`, so its URL was never bare `/` and was
proxied correctly. The console app lives under `/_lcs/ui/`, so `/` never needed to be
excluded. Fixed — the proxy now forwards everything and the bypass list protects app
assets. Production was unaffected (no proxy there), but every Query service would have
been unverifiable in dev.

### Next

### Deliverables due at the 10-service mark

Maintainer will push to a new LCS repo once the 10 core services are done. Required then:

- **README** covering how to run LCS: `docker run` with the Docker socket (needed for
  Lambda, RDS, ECS, EC2), the `_lcs/ui` console URL, AWS CLI/SDK endpoint setup, and the
  `FLOCI_TLS_ENABLED` / `NODE_TLS_REJECT_UNAUTHORIZED` pair the TLS tests need.
- **Attribution tone:** state plainly that LCS builds on the Floci codebase, but do not
  lead with it or structure the README around it. LCS is becoming its own product —
  console, and later its own logic and MicroVM work — not a Floci skin. The MIT licence
  requires the copyright notice be preserved (it is, in NOTICE and
  LICENSES/UPSTREAM-FLOCI-MIT.txt); it does not require prominence.
- **Full compatibility suite** run before the push, not just the Node subset.

### Lambda polish still outstanding

From the maintainer's AWS screenshots, the Lambda console is missing:

- **Code tab** — AWS's first and default tab; not built at all
- Tab order: AWS is Code, Test, Monitor, Configuration, Aliases, Versions; ours starts at
  Configuration
- Function overview panel (Diagram/Template toggle, Add trigger, Add destination)
- Throttle / Copy ARN / Actions buttons
- Configuration sub-navigation — AWS has 15 entries; ours is a single flat panel
- Monitor: AWS shows a metrics grid with a time-range selector, ours shows raw log text

Not buildable here (no backend): X-Ray traces, Infrastructure Composer, MicroVMs,
Application Signals.

---

The skeleton is complete, so remaining console work is per-service depth ("flesh"):
replacing each `ServicePlaceholderPage` with a real AWS-replica surface.

Suggested order — follows AWS console usage and the existing wave plan:

1. **S3** — done (reference implementation).
2. **EC2** — Instances, detail tabs, Security Groups, Key Pairs, Volumes, Elastic IPs.
3. **IAM** — Users, Roles, Groups, Policies.
4. **Lambda** — Functions, detail, invoke/test.
5. **DynamoDB** — Tables, items, indexes.
6. **SQS / SNS** — Queues, topics, subscriptions.
7. **CloudWatch Logs** — Log groups, streams, events.
8. …remaining 45, by wave.

Each service is complete only when it meets `aws-console-parity.md`: side-by-side AWS
evidence, a console↔API assertion, and its 30-scenario pack.

Parallel, independent of console work:

- Phase 2a — edge-router request classifier, validated against the existing 1,968-test
  corpus before any process split.
- Playwright E2E for console flows.
- AWS side-by-side parity evidence for the S3 screens (needs manual screenshots).

---

## Sources

- [Cloudscape Design System](https://cloudscape.design/)
- [cloudscape-design/components (GitHub, Apache 2.0)](https://github.com/cloudscape-design/components)
- [Cloudscape patterns](https://cloudscape.design/patterns/)
- [Table view pattern](https://cloudscape.design/patterns/resource-management/view/table-view/)
- [Details page pattern](https://cloudscape.design/patterns/resource-management/details/details-page/)
- [Split view pattern](https://cloudscape.design/patterns/resource-management/view/split-view/)
- [Create resource pattern](https://cloudscape.design/patterns/resource-management/create/)
- [AWS announcement: Cloudscape open source](https://aws.amazon.com/about-aws/whats-new/2022/07/cloudscape-design-system-open-source-solution-building-intuitive-web-applications/)
- [Micro Frontends: When They Make Sense and When They Don't](https://lukasniessen.medium.com/micro-frontends-when-they-make-sense-and-when-they-dont-a1a06b726065)
- [Should Your Team Be Using Micro Frontends and Module Federation?](https://www.bitovi.com/blog/should-your-team-be-using-micro-frontends-and-module-federation)
- [Solving micro-frontend challenges with Module Federation (LogRocket)](https://blog.logrocket.com/solving-micro-frontend-challenges-module-federation/)
