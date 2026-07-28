# LCS Rebrand Policy

This repository is moving from Floci branding to LCS.

LCS means Local Cloud Services.

## Goal

- User-facing product name becomes `LCS`.
- AWS emulator behavior stays compatible while the rename happens.
- The rename does not break existing users by removing config keys, image names, or SDK assumptions in one unsafe pass.

## Non-Negotiables

- AWS wire compatibility comes first.
- Executable behavior is more important than cosmetic rename speed.
- No blind global search-and-replace across packages, config, URLs, and runtime IDs.

## Rename Phases

### Phase A: User-Facing Name

- Console title, docs title, README title, and high-level product copy should say `LCS`.
- New docs should use `LCS` by default.
- Existing `Floci` references are tolerated only where they are still part of runtime compatibility, package names, env vars, image coordinates, or migration instructions.

### Phase B: Compatibility Aliases

- Add `LCS_*` config aliases for existing `FLOCI_*` settings.
- Keep `FLOCI_*` working until the migration checklist says they can be removed.
- When both are present, `LCS_*` should win.
- Support `lcs.*` system-property aliases for local dev and test runs.

### Phase C: Runtime Artifact Rename

- Rename Docker image names, Compose service names, health labels, docs URLs, and CLI examples.
- Keep compatibility shims where practical.
- Document migration steps for users moving from old image names and environment variables.

### Phase D: Internal Code Rename

- Rename Java packages, test packages, Maven coordinates, and any remaining internal identifiers only after compatibility layers and test evidence are in place.
- Do this with focused validation waves, not one mass commit.

## Definition Of Done

`Floci` is considered fully removed only when all of the following are true:

- User-facing product branding is `LCS` everywhere.
- `LCS_*` config keys exist and the migration off `FLOCI_*` is complete.
- Runtime artifacts and published image names use `LCS` naming.
- Internal package and artifact identifiers no longer use `floci`.
- Compatibility suites still pass after the rename.

## Current Status

- User-facing branding has started.
- Compatibility aliases are implemented for `LCS_*` environment variables and `lcs.*` system properties.
- Internal package and artifact rename is not safe to do as a blind first move.

## Execution Rule

- Each rename slice must update this policy or the master checklist when its status changes.