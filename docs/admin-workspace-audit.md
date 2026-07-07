# Admin Workspace QA And Accessibility Audit

Last updated: 2026-07-07

## Scope

This audit covers the productivity workspace split tracked by GitHub issues #88
and #92:

- Copilot chat
- Cowork projects and project chat
- Code workspace
- Settings and More drawer surfaces
- Dashboard, Tasks, Files, Snippets, and Uptime
- Desktop and narrow/mobile viewports

## Automated Browser Sweep

Run:

```bash
rtk npm run qa:admin
```

The script starts `npm run mock:admin` unless `ADMIN_QA_BASE_URL` is already set.
It captures screenshots under `artifacts/admin-workspace-qa/<timestamp>/` and
writes a `summary.json` with any detected issues.

Latest run:

| Date | Command | Result | Evidence |
| --- | --- | --- | --- |
| 2026-07-07 | `rtk mise exec node@22 -- npm run qa:admin` | Passed | `artifacts/admin-workspace-qa/2026-07-07T12-32-49-293Z/summary.json` |
| 2026-06-19 | `rtk npm run qa:admin` | Passed | `artifacts/admin-workspace-qa/2026-06-19T21-27-26-307Z/summary.json` |

The 2026-07-07 pass ran after all local branches/worktrees were merged into
`main`. It reported no automated workspace issues across desktop and narrow
viewports.

During this pass the closed More drawer was found to keep offscreen controls in
the keyboard tab order. The drawer is now `inert` and `aria-hidden` while closed,
then re-enabled only when opened.

Checked routes:

| Surface | Route |
| --- | --- |
| Dashboard | `#/dashboard` |
| Copilot chat | `#/chat` |
| Cowork projects | `#/projects` |
| Code workspace | `#/gitcode` |
| Settings | `#/settings` |
| Tasks | `#/tasks` |
| Files | `#/files` |
| Snippets | `#/snippets` |
| Uptime | `#/uptime` |

Checked viewports:

| Viewport | Size |
| --- | --- |
| Desktop | 1440 x 1000 |
| Narrow | 390 x 844 |

## Accessibility Checks

The automated sweep checks:

- visible buttons have text, `aria-label`, or `title`
- keyboard tabbing reaches a visible focus target
- pages do not create horizontal overflow
- screenshots are captured for visual review

Manual QA should additionally verify:

- sidebar resize handle is keyboard reachable and persists width
- More drawer opens, closes, and returns focus sensibly
- project chat composer, file open buttons, and download links are reachable
- modal/dialog escape behavior is predictable
- warning/error states use meaningful text and are not color-only

## Current Tradeoffs

- The browser sweep is intentionally dependency-light and does not add `axe`.
- The local Node 26 environment may fail DB-backed Vitest suites until the
  `better-sqlite3` native binding is rebuilt for the active Node ABI.
- Screenshots are generated artifacts and should be attached to QA notes or
  issue comments when reviewing, not committed by default.
