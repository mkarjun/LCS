# LCS Console

React + [Cloudscape](https://cloudscape.design/) console for LCS.

Cloudscape is the design system AWS builds the real AWS Management Console with, open
sourced under Apache 2.0. Using it directly is what makes console parity achievable —
layout density, table behavior, form validation timing, dark mode, and accessibility come
from the same components AWS uses, rather than from imitation.

## Architecture

The console is a browser app that talks to LCS **through the AWS SDK for JavaScript v3**,
exactly the way the real AWS console talks to AWS.

```
Browser (React + Cloudscape + @aws-sdk/client-*)
      │  standard AWS wire protocol, SigV4, port 4566
      ▼
    LCS
```

Consequences worth knowing:

- There is no server-side UI model. Nothing in Java builds console pages.
- Every console interaction is a real SDK call over the real wire protocol, so the
  console doubles as compatibility coverage.
- It works unchanged when services are split across processes behind an edge router.

## Served at `/_lcs/ui/`

The `_lcs` prefix is load-bearing. Path-style S3 addresses buckets at `/{bucket}/{key}`,
so a console at `/console/` would be shadowed by a bucket named `console`. Bucket names
must start with a lowercase letter or digit, so nothing under a leading-underscore prefix
can collide.

`/_lcs/console/summary` remains a separate LCS-native metadata endpoint (which services
are enabled, default region/account). It is not an AWS API and is not required for
service consoles to work — if it is unavailable, status indicators are hidden and
everything else continues to function.

## Development

Start LCS on port 4566, then:

```bash
npm install
npm run dev
```

Open http://localhost:5173/_lcs/ui/.

Vite proxies every non-app path to the emulator, so dev is same-origin with the AWS API
just like production. **Neither path needs CORS.**

## Build

```bash
npm run build
```

Output goes to `src/main/resources/META-INF/resources/_lcs/ui/`, so it ships inside the
runtime image. The Maven `console` profile runs this automatically during
`generate-resources`; skip it with `-Dconsole.skip=true` for backend-only iteration.
`frontend-maven-plugin` downloads its own Node, so no host Node install is required.

## Module boundaries

The console is **one deployable with hard module boundaries**, not micro-frontends.
Federation solves an organizational problem (independent teams, independent release
cadences) that does not exist here — LCS ships as a single image, and nobody upgrades one
service console without upgrading LCS.

```
src/
  shell/        AppLayout, navigation, breadcrumbs, notifications, region/account
  platform/     SDK client factory, endpoint/credential resolution, error mapping
  services/
    registry.ts service manifest — the shell knows nothing about individual services
    s3/         owns its routes, screens, and SDK calls
```

Rules:

- A service module may import from `shell/` and `platform/`. **Never from a sibling
  service.**
- Each service registers itself in `services/registry.ts`.
- Service modules are `React.lazy`-loaded, so each is its own chunk.

Adding a provider later (Azure, GCP) means `providers/<name>/services/`, reusing the same
shell and platform layers.

## Adding a service

1. Create `src/services/<service>/`.
2. Export a default route component (see `s3/S3Routes.tsx`).
3. Register it in `src/services/registry.ts` with its AWS display name and category.
4. Build screens from Cloudscape patterns, matching the AWS console flow for that
   service. See `planning/aws-console-parity.md` for the acceptance bar.
