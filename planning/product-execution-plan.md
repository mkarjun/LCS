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

> These are the numbers as measured when this plan was written, against the legacy Java
> console (`buildGenericPage`). They are the baseline that justified the rewrite, not a
> live status board — do not read them as current. As of 2026-08-17 the catalog holds 70
> services, 10 have a purpose-built React console, and console browser tests number 26
> (three shell-level flows; see the Phase 3a note and the 2026-08-17 session entry).

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

*Partially started (2026-08-17).* The harness exists (`console/playwright.config.ts`,
`console/e2e/`) and three shell-level flows are covered by 26 specs: identity/account
switching, the service list, and the CloudShell terminal. Two things are deliberately
**not** yet done, and the distinction matters:

- Those specs stub the two LCS-native endpoints (`/_lcs/console/summary`,
  `/_lcs/cloudshell/status`) in the browser, so they run with no emulator, no Maven
  build, and no Docker. They validate console behaviour only. **They do not exercise the
  AWS wire protocol**, so the "each test transitively validates the wire protocol"
  benefit above is still unrealised — that requires the real-container variant, which
  reuses the same specs and changes only the fixture.
- No per-service flow (inventory / create / detail / edit / delete) is covered for any of
  the ten built services. That is the bulk of 3a and remains open.

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
| Playwright console E2E — harness | Done |
| Playwright console E2E — shell flows (identity, service list, CloudShell) | Done, 26 specs |
| Playwright console E2E — per-service flows | **Not started** |
| Playwright console E2E — against a real LCS container | **Not started** |

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

### Next — the continuance (as of 2026-08-03)

The skeleton is complete, the 10 core services have real surfaces, and CloudShell is done.
What remains splits into three tracks that do not block each other.

**Track A — prove what exists (highest priority, blocks any public release).**
Nothing here adds a feature; it establishes that what is already built actually works.

1. ~~Run the five unrun compatibility suites (Python, AWS CLI, Go, Rust, Java). Node is the
   only one ever run, and not since the emulator fixes.~~ **Corrected 2026-08-17.** This
   was wrong. `.github/workflows/compatibility.yml` runs a matrix of eight — node, python,
   java, go, awscli, cdk, terraform, opentofu — so they do run. There is no Rust suite in
   the repository at all, so it cannot be "unrun".

   The real gap is the trigger: `on: pull_request` with path filters, and nothing else.
   Work pushed straight to `main` never runs them, which is how this branch has been
   working. So the suites are wired and have passed, but not necessarily against the tip
   of `main` — which is exactly the "ran before the emulator fixes" worry.

   What to do: add a `push: branches: [main]` trigger (or a schedule) so direct pushes are
   covered, then confirm a green run against current `main` before release.
2. Sweep for remaining Query-protocol member-name defects across all 70 services.
3. Playwright E2E for the console: per T1 service, inventory / create / detail / edit /
   delete / empty / error, plus the console↔API out-of-band assertion from Phase 3b.
   The harness and three shell-level flows landed 2026-08-17 (26 specs); the per-service
   work below is untouched, and nothing yet runs against a real container, so no console
   test currently exercises the wire protocol.
4. Capture AWS side-by-side parity evidence for the 10 built services.

**Track B — finish the 10 (the "100% pass" already agreed).**
Work the completeness backlog below, service by service. Biggest single item is Lambda's
missing Code tab; the largest systematic one is making the first eight services grey out
unavailable AWS entries the way RDS and CloudFormation do, so the console is consistent.

**Track C — widen.**
Only after A and B. The next 10 services by usage, then the rest by wave. Resist starting
this early: a wide, shallow console that has never been tested is worth less than a narrow
one that has.

Phase 2 (edge-router classifier) remains independent of all three and can be picked up by
anyone not working the console.

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
- Playwright E2E for console flows — harness and the three shell flows are done; the
  per-service flows and the real-container run are not.
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

## Completeness backlog (deferred to the 100% pass)

Strategy agreed with the maintainer: take all 10 core services to ~70-80% first, then a
dedicated pass to bring those 10 to 100%, then start the next 10. Gaps found so far,
recorded here so the pass has a concrete checklist.

### Lambda
- ~~**Create function errors out with no execution role.**~~ **Resolved 2026-07-31.** The
  create-function form now defaults to "Create a new role with basic Lambda permissions"
  (AWS's own default): it calls IAM `CreateRole` with a Lambda trust policy and attaches
  `AWSLambdaBasicExecutionRole` before `CreateFunction`, so a fresh account with zero roles
  can create a working function. "Use an existing role" and AWS's policy-template
  multiselect (SQS/DynamoDB/Kinesis/VPC service-role policies) are also offered. Role
  auto-creation is retried once on a name collision. Verified end to end against the
  emulator: CreateRole → AttachRolePolicy → CreateFunction returns State=Active.
- ~~**Code tab**~~ **Resolved 2026-07-31.** In-browser code editor built (`CodeEditor.tsx`
  + `lambdaZip.ts`): fetches the deployment package from GetFunction's `Code.Location`,
  unzips it in the browser (stored + deflate via `DecompressionStream`), shows a file list
  beside a text editor, and **Deploy** rebuilds the zip and calls `UpdateFunctionCode` —
  the exact AWS round-trip. Container-image functions get a notice, as in AWS. Verified end
  to end: edited in the browser, deployed, re-read the package over `Code.Location` and the
  new source was there. A full Monaco/Cloud9 editor is not reproducible under the artifact
  CSP, so this is a lighter editor with the same loop.
- ~~Tab order wrong~~ **Fixed.** Now Code, Test, Monitor, Configuration, Aliases, Versions,
  with **Code** as the default tab.
- ~~Function overview panel~~ **Built** (`FunctionOverview.tsx`): Diagram/Template toggle
  (Template renders a read-only SAM view), function box with layer count, ARN + copy,
  description, last modified. **Add trigger / Add destination** are shown greyed — no
  single-surface console trigger flow in LCS yet.
- ~~Throttle / Copy ARN / Actions buttons~~ **Built.** Copy ARN copies to clipboard;
  Throttle sets reserved concurrency to 0 via `PutFunctionConcurrency` (with a confirm);
  Actions holds Test and Delete function (`DeleteFunction`, with a confirm).
- ~~Configuration sub-navigation~~ **Built** (`ConfigurationTab.tsx`): a left rail with
  General configuration, Environment variables, Permissions, Concurrency, and Tags backed
  by real data; the other AWS entries (Triggers, Destinations, VPC, Monitoring tools, Async
  invocation, Function URL, File systems, Code signing, Runtime management) are greyed with
  a reason, matching the nav convention.
- Monitor: still no metrics grid — LCS produces no Lambda metrics, so the tab shows an
  explanatory alert plus recent CloudWatch log events (greyed-metrics honesty rather than a
  fake chart).

### EC2
- ~~**No create actions on resource pages.**~~ **Resolved 2026-07-31.** `ResourceListPage`
  now carries per-resource create modals and an Actions menu (delete, plus edit-rules for
  security groups), with row selection, sorting, and a `CollectionPreferences` panel
  (page size, wrap lines, column visibility). Create flows added — all over write-then-read
  verified APIs: **Key Pairs** (RSA/ED25519, downloads the .pem once), **Security Groups**
  (with an inbound/outbound rule editor over Authorize/Revoke), **Volumes**, **VPCs**,
  **Subnets**, **Route Tables**, **Internet Gateways**, **Elastic IPs** (allocate). Delete
  is wired for volumes, security groups, key pairs, VPCs, subnets, route tables, internet
  gateways, and release for Elastic IPs, each with an AWS-shaped confirm (retype "delete"
  on the destructive ones). Still read-only, by design: Load Balancers, Target Groups,
  Listeners, Auto Scaling groups/launch configs (no Create*/Delete* in LCS), Network
  Interfaces (no CreateNetworkInterface), AMIs, Instance Types.
- Backend key-pair fixes landed with the create flow: `CreateKeyPair` now honours
  `KeyType` (rsa/ed25519) and inline `TagSpecification`s; `DescribeKeyPairs` now emits
  `keyType` and `createTime`; `ImportKeyPair` infers the type from the key material and
  applies tags. So the Key Pairs table's Type and Created columns are real.
- Security group rule counts now read "N Permission entries" (AWS's wording), the group ID
  column is present, and an Owner column was added.
- Still open: No Connect page (EC2 Instance Connect / Session Manager / SSH client tabs).
  No Actions submenus on instances (Instance settings, Networking, Security, Image and
  templates). No inline Name editing. Attaching an internet gateway to a VPC, associating a
  route table with a subnet, and adding routes are not yet exposed (the APIs exist:
  AttachInternetGateway, AssociateRouteTable, CreateRoute). No split detail panel on the
  resource pages.

### S3
- No Metrics or Management tabs.
- Upload is text-only; no binary or multipart.

### IAM
- ~~No create flows for roles, groups, or policies (users only).~~ **Resolved 2026-07-31.**
  - **Create role** — trusted entity type (AWS service / AWS account / custom trust
    policy), a service-principal picker limited to services LCS runs, cross-account with
    MFA + external-ID conditions, a live trust-policy preview, and a managed-policy
    multiselect attached via `AttachRolePolicy` after create. Web-identity and SAML options
    are shown disabled — no `CreateOpenIDConnectProvider`/`CreateSAMLProvider` in LCS.
  - **Create group** — name, optional user membership (`AddUserToGroup`), optional attached
    policies (`AttachGroupPolicy`).
  - **Create policy** — JSON document tab with client-side JSON validation. The visual
    editor is deliberately omitted (no per-service action catalogue to drive it).
- ~~No policy document viewer on the Policies page.~~ **Resolved 2026-07-31.** The policy
  name opens a document modal (`GetPolicy` + `GetPolicyVersion`, decoded and pretty-printed)
  with ARN/default-version/last-edited metadata and Copy.
- Follow-up policies (role/group attach) are best-effort: the identity is created even if an
  attach fails, and the notification names what did not land — matching how AWS sequences
  these as separate calls.

### DynamoDB (from the maintainer's AWS screenshots)
- **Table detail tabs are wrong.** AWS uses Settings, Indexes, Monitor, Global tables,
  Backups, Exports and streams, Permissions. Ours uses Overview, Explore items, Tags.
- **Explore items is a separate page**, not a tab: it has a Scan/Query builder with table
  and index selection, attribute projection, optional filters, and Run/Reset - reached
  from an "Explore table items" button on the table page.
- Table detail is missing a left mini-panel listing tables for quick switching.
- Tables list is missing columns: Indexes, Replication Regions, Deletion protection,
  Favorite, Read/Write capacity mode split, Table class.
- Missing sections on the Settings tab: Read/write capacity, Auto scaling activities,
  Warm throughput, Deletion protection, TTL, Encryption.
- Missing nav entries AWS has. **Probed 2026-07-29 — my earlier "no backend" claim was
  wrong for several of these:**
  - `PartiQL editor` — **SUPPORTED** (`ExecuteStatement` works). Buildable now.
  - `Exports to S3` — **SUPPORTED** (`ListExports` works). Buildable now.
  - Point-in-time recovery — **SUPPORTED** (`DescribeContinuousBackups`).
  - Time to Live — **SUPPORTED** (`DescribeTimeToLive`).
  - Kinesis streaming destination — **SUPPORTED**.
  - `Backups` — not supported (`ListBackups`).
  - `Imports from S3` — not supported (`ListImports`).
  - `Global tables` — not supported (`ListGlobalTables`).

  Lesson repeated: assuming "no backend" without probing understates what is buildable.
  The Settings tab can carry real PITR and TTL sections, and PartiQL deserves a page.

### CloudWatch
- Log group `creationTime` renders as "—"; DescribeLogGroups does not return it here.
- No Logs Insights, no metric graphing, no alarm creation.

### RDS (from the maintainer's AWS screenshots of "Aurora and RDS")

Everything below is **greyed in the console**, not omitted — see the
`unavailableNavItem` / `unavailableCell` helpers. Each greyed control carries a tooltip
naming the missing API, so the rail and the tables keep the shape of the AWS console.

Nav entries greyed (the API each one needs):
- `Query editor` — the RDS Data API is a separate service in this emulator
- `Performance insights` — no performance metrics are collected
- `Snapshots` — `DescribeDBSnapshots` is a wire-accurate empty stub; `CreateDBSnapshot`
  is not implemented, so the list can never be non-empty
- `Exports in Amazon S3` — `StartExportTask`
- `Automated backups` — `DescribeDBInstanceAutomatedBackups`
- `Reserved instances` — no billing model
- `Proxies` — `DescribeDBProxies` is another empty stub; `CreateDBProxy` is missing
- `Option groups` — `CreateOptionGroup`
- `Custom engine versions` — `CreateCustomDBEngineVersion`
- `Zero-ETL integrations` — `CreateIntegration`
- `Events` / `Event subscriptions` — `DescribeEvents`, `CreateEventSubscription`
- `Recommendations` — `DescribeDBRecommendations`
- `Certificate update` — `DescribeCertificates`

Databases table columns greyed: `Upgrade rollout order`, `Recommendations`, `CPU`,
`Current activity`, `Maintenance`. The last four need CloudWatch metrics and
`DescribePendingMaintenanceActions`, none of which RDS publishes here.

Create database — AWS sections **not built**, and why:
- **Templates** (Production / Dev-Test) — presets over fields that already exist; no API.
- **Cluster scalability type** (Aurora serverless / Limitless / Provisioned) and **Type of
  provisioned configuration** — LCS models neither Aurora serverless nor instance families.
- **Cluster storage configuration** (Aurora I/O-Optimized vs Standard) — a pricing choice.
- **Compute resource** (connect to an EC2 instance) — no such wiring.
- **Network type** (IPv4 / dual-stack) — the emulator is IPv4 only.
- **Certificate authority** — `DescribeCertificates` is missing.
- **RDS Data API toggle** — `EnableHttpEndpoint` is not honoured on create.
- **Read replica write forwarding**, **Babelfish** — no backend.
- **Monitoring** (Database Insights, Performance Insights, retention, KMS key) — no metrics.
- **Create new VPC security group** inline — the picker only lists existing groups.
- Engine tiles for Aurora MySQL, Aurora PostgreSQL, Oracle, SQL Server, and IBM Db2 are
  **shown disabled**: LCS has container images only for PostgreSQL, MySQL, and MariaDB.
- `Create database` splits into Express configuration / Full configuration / Restore from
  S3 as AWS does; only Full configuration is enabled.

Other RDS gaps:
- **Modify covers three fields.** `ModifyDBInstance` here honours only
  `MasterUserPassword`, `EnableIAMDatabaseAuthentication`, `DBSubnetGroupName`, and
  `VpcSecurityGroupIds`. Allocated storage and instance class are accepted and silently
  ignored, so they are not offered — verified by write-then-read (`--allocated-storage 30`
  read back as 20).
- **Parameter groups list only what has been written to them.** The editor works — the
  `Parameters.Parameter.N` request encoding is now parsed (see the wire-format fixes below)
  and values read back through `DescribeDBParameters`, verified from the browser. But LCS
  stores no engine defaults, so a new group starts empty where AWS shows the engine's full
  parameter set with defaults, and there is no "modified only" filter or reset-to-default.
- **Cluster modify** is not offered at all: `ModifyDBCluster` takes only the master
  password and the IAM auth flag.
- `DescribeDBInstances` omits `InstanceCreateTime`, `BackupRetentionPeriod`,
  `StorageEncrypted`, and `DeletionProtection`, so those fields have no detail-page rows.
- AWS's `Monitoring` and `Logs & events` instance tabs are not built — no metrics, no
  database log files.

### CloudFormation (from the maintainer's AWS screenshots)

Nav entries greyed (the API each one needs):
- `Stack refactors` — `CreateStackRefactor`
- `Infrastructure Composer` — a console-only visual template builder
- `IaC generator` — no resource-scanning API
- `Hooks overview` / `Invocation summary` / `Hooks` — the Hooks APIs
- Registry section: `Public extensions` / `Activated extensions` / `Publisher`
- `Spotlight` — a console feature with no API behind it

Stacks page:
- **Description column greyed.** `DescribeStacks` returns no stack description. The `Stack`
  model has no description field either; adding one means parsing it out of the template
  at create time.
- **View nested toggle disabled.** `DescribeStacks` returns no `ParentId`, so there is
  nothing to filter nested stacks by.
- `Stack actions` menu is present with every entry disabled: `Detect drift`
  (`DetectStackDrift` missing), `Import resources into stack` (no resource import), and
  `Edit stack policy` (`SetStackPolicy` is accepted but never enforced).
- `Create stack` splits into AWS's two options; `With existing resources (import
  resources)` is disabled.
- Filter status is client-side over the loaded stacks, not the `ListStacks`
  `StackStatusFilter` parameter.

Create stack:
- **Amazon S3 URL works** — `CreateStack` honours `TemplateURL`, verified end to end
  against a template served from an LCS bucket. `Sync from Git` is disabled.
- Build-from-Infrastructure-Composer is omitted rather than greyed: it is a whole
  console-only application, not a field.
- AWS's wizard steps 3 and 4 (Configure stack options, Review and create) are not built:
  rollback configuration, notification ARNs, stack policy, timeout, and the review screen
  have no emulator equivalent.

Other CloudFormation gaps:
- **Change sets have no diff.** `DescribeChangeSet` returns an empty `Changes` list by
  design, so the stack's Change sets tab lists sets and their status with no per-resource
  preview, and there is no create/execute change set flow.
- `ListChangeSets` summaries carry no `CreationTime`, so that column reads "—".
- Stack outputs carry no `Description`, so that column reads "—" too.
- No drift detection, so AWS's drift status column and Drifts tab are absent.
- No `ListImports`, so Exports has no "stacks that import this export" drill-down.
- StackSets: create takes a name, description, and template only. AWS's permission models,
  deployment targets, and rollout options have no equivalent here, and the instance and
  operation views are not built.
- Template tab is a read-only textarea, not AWS's editor with the JSON/YAML toggle.

### Emulator wire-format bugs found by building these consoles

The console talks to LCS with the AWS SDK for JavaScript, which is stricter than botocore.
Three defects were invisible to the AWS CLI and the compatibility suite:

1. **`DescribeDBClusters` emitted `<DBClusterMembers><member>`.** The RDS model names that
   list's member `DBClusterMember`. botocore falls back to `member`, so the CLI parsed it;
   the JS SDK dropped every entry and every cluster looked empty. **Fixed.**
2. **`DescribeDBParameters` / `DescribeDBClusterParameters` emitted `<Parameters><member>`**
   where the member is named `Parameter`. Same class of bug. **Fixed.**
3. **`ModifyDBParameterGroup` read `Parameters.member.N.ParameterName`** but every AWS SDK
   sends `Parameters.Parameter.N.ParameterName`, so no parameter set over the wire was ever
   stored. **Fixed** — `parseParameterList` now accepts both spellings.

Also fixed: **`DescribeStacks` never returned the stack's `Parameters`.** Two causes, both
needed: `stackToXml` never wrote the element, and `Stack.parameters` was never populated —
the values lived only on the change set that applied them. The console's Parameters tab
was empty for every stack.

4. **Neptune and DocumentDB carried the same `DBClusterMember` defect.** Both
   `NeptuneQueryHandler.clusterXml` and `DocDbQueryHandler.clusterXml` emitted
   `<DBClusterMembers><member>`. **Fixed and verified 2026-08-03** — 36/36 DocDB + Neptune
   integration tests green.

   **The existing tests could not have caught it, and that was the more important find.**
   `clusterHasInstanceMember` in both suites asserted only that the instance id appeared in
   the response — which is true under *either* element name. Both now assert
   `<DBClusterMember>` is present and `<member>` is absent. The guard was checked by
   reintroducing the bug: the test fails, then passes again once reverted. An assertion
   that has never been seen to fail is not yet a guard.

Lesson to add to the list: **probe with the same SDK the console uses.** The AWS CLI is a
more forgiving parser than the JS SDK, so "the CLI shows it" is not evidence the wire
format is right.

**This class of bug is not exhausted.** Only the lists that a console screen happened to
render have been checked. Any Query-protocol list shape whose member has a custom name is a
candidate, across all 70 services. Worth a systematic sweep rather than waiting for each one
to surface: grep for `.start("` immediately followed by `start("member")` and check each
against the AWS model.

### CloudShell

Built and working end to end; these are the gaps against AWS, all deliberate.

- **Command audit is keystroke-derived.** `CommandLineTracker` rebuilds lines from stdin, so
  history recall and tab completion are logged as what was *typed*, not what *ran*. An exact
  record needs shell-side instrumentation (a `PROMPT_COMMAND` hook writing history out of
  band).
- **No credential auto-refresh mid-session.** Credentials are minted for the full session
  lifetime (12 h), so they cannot expire inside a session the reaper would have ended
  anyway. Needed only if that cap is raised.
- **Sessions are per browser, not per user.** LCS has no login; the console mints a session
  id into `localStorage`. Two browsers are two environments.
- **AWS config with no LCS meaning is not offered** rather than accepted and ignored:
  instance type, subnet/VPC/security group, EBS size. "Create VPC environment" is shown
  disabled — LCS models VPCs as metadata, with no network to place a shell into.
- **Playwright coverage landed 2026-08-17** (`console/e2e/cloudshell.spec.ts`, 8 specs).
  Covers all four transport paths — backend unavailable, a legacy build answering the
  status path with index.html, LCS unreachable, and a mocked gateway WebSocket asserting
  the `session.ts` frame format in both directions — plus session-id reuse across reload,
  the welcome dialog, and Region-titled tabs. The scripted `websockets` client remains
  useful against a real backend; the browser test is what was missing.
  Still uncovered: file upload/download, restart/delete, split panes, and fullscreen.
- Terminal font/theme are not user-configurable; AWS's CloudShell settings dialog exposes
  both. Ours reports configuration rather than changing it.

### Cross-cutting
- No delete/edit actions on most detail pages.
- No tag editing anywhere (tags are read-only) — RDS create is the one place tags can be
  set, and only at creation time.
- No Playwright E2E coverage for any *per-service* flow. The shell-level flows (identity/
  account, service list, CloudShell) were covered 2026-08-17; every service's inventory /
  create / detail / edit / delete path is still untested in a browser.
- **Greying vs omitting.** RDS and CloudFormation grey out AWS entries LCS cannot back;
  the six services built before them (S3, EC2, IAM, Lambda, DynamoDB, SQS, SNS,
  CloudWatch) omit them instead. Those eight should be revisited to use
  `unavailableNavItem` so the whole console is consistent.

---

# RESUME HERE (start of a fresh session)

Everything below is what a new session needs to continue without re-deriving anything.

## Current state

- Branch: `claude/ec2-lambda-core-features-7d0822`.
- **Repo / licence changed (2026-07-31).** LCS now lives in the maintainer's own repo,
  **`https://github.com/mkarjun/LCS.git`** (git remote `lcs`). Do **not** push to
  `floci-io/floci` (upstream; `origin` still points there). Project relicensed to
  **Apache-2.0** (`LICENSE`); upstream Floci MIT preserved verbatim in
  `LICENSES/UPSTREAM-FLOCI-MIT.txt` + `NOTICE`. Open-core direction (free core, paid
  enterprise later). `gh` CLI not installed — PRs open via the URL git prints on push.
- Console coverage: **all 10 core services** have real surfaces —
  S3, EC2, IAM, Lambda, CloudWatch, DynamoDB, SQS, SNS, **RDS**, **CloudFormation**.
  The other 60 are reachable via honest placeholder pages.
- **CloudShell is complete** (all four phases) and verified against a running emulator.
  See `planning/cloudshell.md`.
- Upstream merged: 457 commits, 52 -> 70 services. Node compatibility suite passed
  433/433. **The other five suites (Python, AWS CLI, Go, Rust, Java) have not been run,
  and none has been re-run since the emulator fixes recorded in the backlog.**

## Open items — do these before anything else

Ordered by what blocks a release, not by size.

1. **Free disk on the build host.** C: hit 100% on 2026-08-03 during repeated image builds.
   `docker builder prune` recovered ~7 GB, which was enough to finish, but Docker Desktop's
   WSL2 VHDX does not shrink on its own — reclaiming the rest needs `wsl --shutdown`
   followed by a VHDX compact, which stops every running container on the machine, so it is
   a maintainer decision. A full disk makes Maven fail in ways that look like code errors.
2. **Run the five unrun compatibility suites** (Python, AWS CLI, Go, Rust, Java). Only Node
   has ever been run, and not since any of the emulator fixes. This is the single largest
   unknown in the project: five of six suites have never been green on this branch.
   *Nothing should be announced publicly before this passes.*
3. **Sweep for remaining Query-protocol member-name defects** across all 70 services (see
   the wire-format section above). Four have been found by accident; there is no reason to
   think that is all of them.
4. **Playwright console E2E** — harness plus three shell-level flows landed 2026-08-17
   (26 specs, `console/e2e/`). The remainder of Phase 3a is still open: no per-service
   flow is covered for any of the ten built services, and nothing runs against a real
   LCS container, so no console test yet exercises the AWS wire protocol. Per-service
   screens are still only ever tested by hand.
5. **AWS side-by-side parity evidence** — still not captured for any service, so
   `aws-console-parity.md`'s bar is unmet by its own definition. Needs manual screenshots.

### Session 2026-07-31 — EC2/IAM/Lambda depth, CloudShell, shell polish

Shipped and pushed to `mkarjun/LCS` this session:

- **EC2 create/manage.** `ResourceListPage` gained per-resource create modals + an Actions
  menu (delete, edit security-group rules), row selection, sorting, `CollectionPreferences`.
  Create flows: key pairs (RSA/ED25519, downloads .pem), security groups (rule editor),
  volumes, VPCs, subnets, route tables, internet gateways, Elastic IPs. Backend key-pair
  fix: `CreateKeyPair` honours KeyType + inline tags; `DescribeKeyPairs` emits keyType +
  createTime; `ImportKeyPair` infers type. **(Java key-pair change unverified locally —
  needs image rebuild.)**
- **IAM create flows.** Create role (service/account/custom trust, live preview, managed-
  policy attach), create group (users + policies), create policy (JSON + validation),
  policy document viewer. *Still a single modal, not AWS's 3-step wizard — noted as
  follow-up.*
- **Lambda — the big one.**
  - Auto execution-role on create (CreateRole + AttachRolePolicy(AWSLambdaBasicExecutionRole)
    before CreateFunction) — a fresh account can create a working function.
  - **Code tab** (in-browser editor): fetch package via Code.Location, unzip
    (stored+deflate), edit, Deploy → UpdateFunctionCode. Verified round-trip.
  - Detail rebuilt: overview panel (Diagram/Template, Add trigger/destination), header
    Copy ARN / Throttle / Actions, tab order Code/Test/Monitor/Configuration/Aliases/Versions.
  - **Configuration fully editable + AWS-order rail**: General, Environment variables, Tags,
    Concurrency editable; **Triggers** (ListEventSourceMappings + Add via
    CreateEventSourceMapping + delete), **Destinations** (PutFunctionEventInvokeConfig),
    **Permissions** (role link + GetPolicy statements + AddPermission/RemovePermission).
    Font/theme bug fixed (was hardcoded black; now Cloudscape `<Box color>`).
- **CloudShell (frontend, phase 1).** New top-nav launch icon → `/_lcs/ui/cloudshell`.
  xterm.js terminal (ANSI/UTF-8/mouse/copy-paste/resize/history), AWS-parity chrome
  (title + Actions dropdown, region-named tabs, split rows/columns, fullscreen, welcome
  dialog, drag-drop upload), WebSocket transport with reconnect + documented protocol +
  in-browser preview-shell fallback. Backend (gateway → docker exec PTY, session/cred/
  volume managers, STS creds, IAM via existing filter) **specced in
  `planning/cloudshell.md`, not built** — the WebSocket is the seam.
- **Shell polish.** Top-nav utility cluster (Help / Notifications-with-badge / Settings);
  Settings = user settings (Visual mode light/dark/browser via `applyMode`, persisted) not
  region/account; search bar left-aligned to match AWS.
- **E2E.** `examples/lambda-e2e/` — self-checking script (env vars + SQS trigger +
  destination config), **all 5 checks green** against the container. Found + documented:
  async destination *delivery* is not emulated (config stored, not delivered).
- **README** rebranded Floci → LCS (upstream-specific links dropped, not repointed;
  `FLOCI_*` env vars kept verbatim with a rename note).

### Session 2026-08-03 — CloudShell backend (phases 2–4)

CloudShell is now end to end. The frontend's WebSocket seam is met by a real gateway, so
`useSim` is gone: the console probes `/_lcs/cloudshell/status` and only runs the preview
shell when LCS says a real one cannot be served, showing LCS's own reason for it.

New package `io.github.hectorvent.floci.cloudshell` — gateway (`docker exec` PTY over the
documented frame protocol), session manager with idle/lifetime reaping, container and
home-volume provisioning, STS session credentials registered with `IamService`, file
upload/download, and a CloudWatch Logs audit trail. Config lives under
`floci.services.cloudshell.*`. Tools image: `docker/cloudshell/Dockerfile`. Full detail and
the known limits are in `planning/cloudshell.md`.

Things worth carrying forward:

- **`PipedInputStream` is the wrong stdin for a WebSocket-fed PTY.** It remembers the last
  writing thread and throws `"Write end dead"` once that thread exits; WebSocket frames
  arrive on whichever Vert.x event-loop thread is current. `TerminalInputStream` is a
  queue-backed stream instead.
- **PTY output must be UTF-8 decoded incrementally.** A multi-byte character straddles two
  chunks routinely — decoding each chunk alone turns the AWS CLI's table borders into
  replacement characters.
- **Vite's catch-all proxy cannot carry the terminal socket.** Setting `ws: true` on the
  `^/` entry would also intercept Vite's own HMR socket, so `/_lcs/cloudshell` gets its own
  proxy entry, declared first.
- **A Vert.x result handler runs back on the event loop.** Splitting "start the container"
  into `executeBlocking` and leaving the `execCreateCmd` in `onSuccess` puts a synchronous
  Docker call on the event loop. Both halves belong in the blocking step.

Two bugs that only a running emulator could have found, both of which unit tests and
type-checking passed straight over:

- **A launched container must be given LCS's embedded DNS** (`withEmbeddedDns()`).
  `ContainerReachableEndpoint` hands the workload `http://localhost.floci.io:4566` whenever
  the embedded DNS server is up, so without the resolver every AWS CLI call inside the
  container fails with *Could not connect to the endpoint URL*. Every other
  container-launching service already called it; CloudShell did not, and nothing in the
  build caught it. **Check this first when a new container-backed feature cannot reach LCS.**
- **A session id must be stable across page loads.** The first cut minted one per mount, so
  every visit to the page built another container and abandoned the last to the reaper —
  the ten-session cap would be reached in ten visits. The console now remembers the id in
  `localStorage`, which is also what makes "come back to the environment you left" true.
  Only running it in a browser showed this; the scripted WebSocket check passes its own id.
- **`IamService.resolveCallerArn` dereferenced a null `roleArn`** — a pre-existing bug, not
  a CloudShell one. `GetSessionToken` registers sessions with no role, so
  `aws sts get-session-token && aws sts get-caller-identity` has always failed with
  `InternalFailure: Cannot invoke "String.contains(...)" because "roleArn" is null`.
  CloudShell just made it the *first* command a user runs. Roleless sessions now resolve to
  the account root ARN, which is what the handler already fell back to for unknown callers.

### Session 2026-08-17 — Playwright harness + first three console E2E flows

Closed the "zero browser coverage" half of Phase 3a. Before this the console had no
browser test of any kind: Playwright was absent from `console/package.json` and
`node_modules`, with no config and no spec directory.

**Landed.** `console/playwright.config.ts`, `console/e2e/fixtures.ts`, and 26 specs
across three flows — identity/account (10), service list (8), CloudShell (8). Every
key assertion was verified to fail when the behaviour it guards is reintroduced as a
bug, per the working agreement above.

**Deliberate scope limit.** The fixture stubs `/_lcs/console/summary` and
`/_lcs/cloudshell/status` in the browser, so the suite needs no emulator, no Maven
build, and no Docker. The cost is that it proves console behaviour and *not* the wire
format. The real-container variant reuses these specs and changes only the fixture;
until it exists, no console test validates the SDK path.

**"Login" does not exist.** The brief asked for a login flow; LCS has no
authentication, and credentials are deliberately non-secret. The flow was scoped to the
real analogue — the region/account switcher, where an exactly-12-digit access key
selects the account and drives resource isolation.

**Bugs found while writing the tests, all still open:**

- **Anchor hrefs ignore the router basename.** `main.tsx` sets
  `basename="/_lcs/ui"`, but `AllServicesPage.tsx:83` builds its href from `servicePath`
  alone, with no basename prefix, and `AppShell`'s SideNavigation does the same, so the
  rendered anchors read `/s3`, `/opensearch`. Left-click works because `onFollow`
  preventDefaults; middle-click, Ctrl+click and "Copy link address" leave the console.
  Since LCS serves path-style S3 at `/`, `/s3` in a new tab hits the bucket API — the
  same collision commit `dc674021` already fought once.
- **CloudShell can pin its container to the wrong Region.** The mount effect at
  `CloudShellPage.tsx:135` has `[]` deps and captures `region` from `EmulatorContext`'s
  *initial* state, before the summary resolves. With a 400ms summary delay and a direct
  deep-link, the nav reads `eu-west-1` while the tab and the gateway socket both read
  `us-east-1`. `XtermView` deliberately does not reconnect on Region change, so the
  container and its home volume stay wrong for the session's life. It is a race, so it
  passes at 0ms — a real deep-link with a network round-trip is the losing case.
- **Blank region falls back to a hardcoded `us-east-1`** (`RegionAccountModal.tsx:36`)
  rather than `summary.defaultRegion`, while the access-key field correctly defers to
  the summary.
- Minor: `countText` is unconditionally `` `${n} matches` ``, so one result reads
  "1 matches". `catalog.ts` and `AppShell.tsx` comments still claim 52/53/68 services;
  the catalog holds 70, of which 10 have a purpose-built console.

**Harness note.** Timeouts are well above Playwright's defaults on purpose: Vite serves
unbundled ESM in dev, so a cold first navigation pulls ~250 Cloudscape modules through
the optimizer and the `load` event lands past 30s. Warm runs take ~7s. A default-timeout
config passes locally after the first run and fails on a fresh checkout.

## Start the environment

```bash
docker run -d --name lcs -p 4566:4566   -e FLOCI_TLS_ENABLED=true   -v //var/run/docker.sock:/var/run/docker.sock -u root   lcs/lcs:merged
```

Both flags matter. The Docker socket is required for Lambda, RDS, ECS and EC2 —
without it Lambda invocations fail with an opaque socket error. On Windows Git Bash the
socket path must be written `//var/run/docker.sock` or MSYS rewrites it and the container
dies at startup.

Console dev server: `cd console && npm run dev`, then http://localhost:5173/_lcs/ui/
Production console (served by LCS itself): http://localhost:4566/_lcs/ui/

If 5173 is taken, pass a different port — `npm run dev -- --port 5180 --strictPort` — and
confirm which server answered before judging a page: another worktree's dev server on the
same port will happily serve its own, older build. `vite.config.ts` hardcodes 5173, so the
CLI flag is the only override.

## Hard-won lessons — do not relearn these

1. **Probe APIs with write-then-read, never a single read.** A read that errors may mean
   "not configured", not "not implemented". This mistake made every S3 bucket-config API
   look missing when all were fully implemented.
2. **AWS CLI validates client-side.** A probe with a fake resource id never reaches the
   emulator and proves nothing.
3. **Git Bash mangles paths.** `/aws/lambda/x` becomes `C:/Program Files/Git/aws/lambda/x`
   — it silently created a real log group with a mangled name. Use `MSYS_NO_PATHCONV=1`
   for every seeding command.
4. **Do not start a Docker build while editing console source.** It copies a half-written
   tree and fails on `npm run build`, which looks like a real error.
5. **Kill stale containers before verifying.** A previous container holding port 4566 made
   a verification read the *old* image and report the wrong service count.
6. **Python file edits on Windows need `encoding="utf-8"`** — the cp1252 default fails on
   the em dashes in these docs.
7. **Verify the container is actually running** (`docker ps`) before trusting any curl
   result against it.
8. **The AWS CLI is a more forgiving parser than the AWS SDK for JavaScript.** botocore
   falls back to the Query protocol's generic `member` element when a list shape declares
   its own member name; the JS SDK does not, and silently returns an empty list. Three RDS
   wire-format bugs were invisible to the CLI and the compatibility suite and only showed
   up in the console. Probe with the SDK the console actually uses.
9. **A dev server may already hold port 5173.** Another worktree's `npm run dev` will
   answer, serve *its* build, and make new pages look unbuilt. Check what is listening
   before concluding a module did not register.
10. **`useServiceNav` must not JSON round-trip its argument.** Item labels can be React
    elements (greyed nav entries, service icons); `JSON.stringify` strips `$$typeof` and
    React then throws on the parsed object. The hook keys off `title` + `href` instead.
11. **Any container LCS launches needs `withEmbeddedDns()`.** The endpoint handed to the
    workload is `http://localhost.floci.io:4566` whenever the embedded DNS server is up, so
    a container without that resolver fails every AWS call with *Could not connect to the
    endpoint URL*. It compiles, type-checks, and unit-tests fine — only a live session shows
    it. First thing to check when a container-backed feature cannot reach LCS.
12. **A cancelled `docker build` still finishes server-side.** Stopping the client leaves
    BuildKit running and it tags the image anyway, so the tag can hold pre-fix code that
    looks freshly built. Compare image IDs before and after, not just timestamps.
13. **The browser caches `index.html`.** Vite asset filenames are content-hashed, but the
    entry document is not, so a rebuilt console can keep serving the previous bundle to an
    open tab. Compare the `assets/index-*.js` the server returns against the one the page
    actually loaded before concluding a change did not take.
14. **An assertion that has never failed is not a guard.** Four `DBClusterMember` bugs got
    past a 1,968-test suite because the tests asserted the *id* was in the response, which
    is true under either element name. When fixing a wire-format bug, reintroduce it once
    and watch the new test fail before trusting it.
15. **Integration tests that launch containers need the Docker socket.** Running them in a
    Maven container without `-v /var/run/docker.sock:/var/run/docker.sock` gives 500s and
    cascading 404s — 27 failures that look exactly like a broken change. The tell is
    `SocketException: No such file or directory` in the surefire report.
    **`DocDbIntegrationTest` is also timing-flaky under load**: `createCluster` waits on a
    real mongo container and can hit `SocketTimeoutException: Read timed out`, after which
    the `@Order`-dependent tests cascade (`createClusterDuplicateFails` sees 200 instead of
    400, because the cluster it expects to already exist was never created). Observed at
    85 s for the suite when it passes in ~50 s. Re-run the suite alone before believing a
    failure here.
16. **Repeated image builds will fill the disk.** Each LCS image is ~590 MB and BuildKit
    keeps a large cache; C: went from workable to 0 bytes free in one session.
    `docker builder prune` frees space *inside* Docker's WSL2 VHDX, but that file never
    shrinks by itself — reclaiming it on the host needs `wsl --shutdown` plus a VHDX
    compact, which stops every container on the machine. Budget for this before a long
    build session, because a full disk fails in ways that look like code errors.

## Per-service build recipe

Each service module follows the same shape. Copy an existing one — S3 or SQS are the
cleanest references.

1. Probe the API surface with write-then-read round trips. Record what is unsupported.
2. `console/src/services/<name>/<Name>Routes.tsx` — routes plus `useServiceNav`.
3. List page, detail page with tabs, create/action modals.
4. Register in `console/src/services/registry.ts`.
5. `npx tsc --noEmit`, then verify in the browser against real seeded data.
6. Commit with what was verified and what was deliberately omitted.

**Only surface operations that are verified to work — but show the gap.** An AWS nav entry
or column the emulator cannot back is rendered **greyed and inert**, never as a link that
always errors and never silently dropped. Use `unavailableNavItem` from
`console/src/shell/navUnavailable.tsx` for nav entries and the per-service
`unavailableCell` pattern for table columns; both carry a tooltip naming the missing API.
Every greyed control gets a matching line in the completeness backlog above.

Greying is the rule as of RDS and CloudFormation. The eight services built before them
still omit, and are listed in the backlog's Cross-cutting section for the 100% pass.

## Architecture invariants

- Console talks to LCS through `@aws-sdk/client-*`, exactly as the AWS console talks to AWS.
  There is no server-side UI model.
- Served at `/_lcs/ui/`. Never `/console/` — path-style S3 puts buckets at `/{bucket}/{key}`,
  so a bucket named "console" would shadow it.
- Same-origin in dev (Vite proxy) and prod (served by LCS), so **no CORS is needed**.
- Module boundaries: a service may import from `shell/` and `platform/`, never a sibling.
- Service icons are original pictograms, never AWS Architecture Icons (separate licence).
