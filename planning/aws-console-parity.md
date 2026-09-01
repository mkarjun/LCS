# AWS Console Parity Rubric

Use this rubric before marking any console surface complete.

## Goal

LCS console pages should be visually and behaviorally close enough to AWS that an AWS user can move through the same task with near-zero relearning.

## Visual Parity

- Match AWS information density. Avoid oversized cards, extra whitespace, or consumer-style marketing layouts in service pages.
- Match AWS hierarchy: page title, summary bar, action bar, filters, table, tabs, side panels, breadcrumbs.
- Match AWS table behavior: row selection, sticky headers where AWS uses them, sortable columns, pagination placement, empty-state placement.
- Match AWS language and labels where the workflow is the same. Keep LCS branding at the shell level, not inside service task wording.
- Match AWS destructive-action affordances, warning styling, and inline help placement.

## Behavioral Parity

- Match AWS navigation order: service landing page, inventory view, detail view, tab order, breadcrumbs, and back-path expectations.
- Match AWS create flows: modal versus full-page flow, step order, default values, validation timing, and confirmation behavior.
- Match AWS loading and refresh behavior: spinners, disabled controls, polling cadence, and stale-data recovery.
- Match AWS search and filter behavior: submit timing, reset behavior, chip or token handling, and empty-result copy.
- Match AWS notification behavior: toast placement, success copy, failure copy, and retry affordances.

## Do Not Invent

- Do not add console pages for services where AWS has no meaningful first-class surface unless LCS explicitly needs an operator helper.
- Do not simplify workflows just because the emulator backend is smaller. Preserve AWS task shape first.
- Do not replace AWS table or form patterns with generic dashboard widgets.

## Evidence Required

- Side-by-side screenshot or screen recording against AWS for the same flow.
- Executable validation proving the console action matches API state.
- Notes for any intentional divergence and why AWS parity could not be preserved.
## Captured AWS structure (2026-09-01)

Transcribed from the maintainer's live AWS console (account 008971661427, us-east-1) in a
signed-in browser. This is the evidence the rubric asks for, for the services it covers.
Everything below is what AWS *does*, not what LCS does.

### VPC — corrections it forced

Four things the LCS VPC console had wrong on its first pass, all now fixed:

| Got wrong | AWS actually does |
|---|---|
| Panel titled "VPCs by Region", one long count row | **"Resources by Region"**, a two-column grid of one card per resource |
| A "Your VPCs" table on the dashboard | No table — the VPC list is behind the "VPCs" card |
| Endpoints under "Virtual private cloud" | Under **"PrivateLink and Lattice"** |
| A "Network Analysis" nav section | Does not exist — the analyzers moved to AWS Network Manager |

Plus: "Network interfaces" is **not** in the VPC nav at all (EC2 only); the detail page
titles itself `vpc-id / Name` on one line; **Details is a panel above the tabs, not a
tab**, and the default tab is **Resource map**; the only header control is an Actions
menu, with Delete inside it.

AWS's full VPC nav, in order: VPC dashboard · Filter by VPC · AWS Global View · *Virtual
private cloud* (Your VPCs, Subnets, Route tables, Internet gateways, Egress-only Internet
gateways, Carrier gateways, DHCP option sets, Elastic IPs, Managed prefix lists, NAT
gateways, Peering connections, Route servers) · *Security* · *PrivateLink and Lattice* ·
*DNS firewall* · *Network Firewall* · *Virtual private network (VPN)* · *AWS Verified
Access* · *Transit gateways* · *Traffic mirroring*.

Not built, recorded so the gap is deliberate rather than forgotten:

- **"Filter by VPC" in the nav.** A global VPC filter that scopes every table on every
  page. Real feature, not cosmetic — worth its own change.
- **The split panel** under the VPC table ("Select a VPC above"), AWS's inline detail view.
- **Resource-map connector lines.** The four columns and their chips are built; the lines
  between them are not. Doing it properly means measuring rendered chip positions and
  painting an SVG overlay that survives resize and theme changes.
- **En dash, not em dash.** AWS renders an unset field as `–` (U+2013). The whole LCS
  console uses `—` (U+2014), and a comment in `InstanceDetailPage.tsx` asserts em dash is
  what AWS does. That comment is wrong. Left alone rather than half-changed: it is a
  one-character sweep across every service surface and belongs in its own commit.

### The next four, as AWS lays them out

Captured to spec the builds, so each starts from AWS's shape rather than a guess.

**API Gateway** — nav: APIs · Custom domain names · Domain name access associations · VPC
links · AgentCore targets · *(divider)* Usage plans · API keys · Client certificates ·
Settings · *Developer portals* (Portals, Portal products). The APIs table counts
`(6/6)` — shown/total, not just total — and uses **radio buttons, single-select**, with
Delete and Create API in the header. Columns: Name (link) · Description · ID · Protocol ·
API endpoint type · Created · Security policy · API status.

**EventBridge** — nav: Dashboard · *Developer resources* (Learn, Sandbox, Quick starts) ·
*Buses* (Event buses, Rules, Global endpoints, Archives, Replays) · *Pipes* · *Scheduler*
(Schedules, Schedule groups, Scheduled rules (legacy)) · *Integration* (Partner event
sources, API destinations, Connections) · *Schema registry*. **This confirms the VPC
lesson a second time:** our catalog's `events`, `scheduler`, and `pipes` are three service
ids but *one* AWS console. Build them as one module with three route trees, the way
`vpc` now sits inside `ec2`. The landing page is a marketing/getting-started page, not a
dashboard — worth diverging from, since LCS has no pricing or videos to show.

**Step Functions** — nav: Dashboard · State machines · Execution inspector · Activities ·
*Developer resources*. The State machines page is **not** wrapped in a container: an `h1`
sits directly above a bare table. Header carries a "View execution counts" toggle, then
refresh, View details / Edit / Copy to new / Delete (disabled until selection), and Create
state machine. Filter row is a search box **plus a type dropdown** ("Any type").
Columns: Name · Type · Creation date · Status.

**Secrets Manager** — **no left navigation at all**, just a breadcrumb and a flat list.
Title "Secrets" with **no counter**, refresh, and "Store a new secret". Filter placeholder
names every field it searches: "Filter secrets by name, description, tag key, tag value,
owning service or primary Region". Columns: Secret name (link) · Description · Last
retrieved (UTC) · Created on (UTC). No container border around the table.

Two patterns worth carrying into all four: AWS stamps inventory tables with **"Last
updated / N ago"** beside the refresh control (now added to the shared LCS table), and
every column header carries its own **sort/filter caret**.
