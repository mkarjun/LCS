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