# Focus Stack Foundation Design QA

Date: 2026-07-20
Scope: issue #158, Slice 1 shell foundation and audited route polish

## Final branch review gate

- **RED — blocked:** The hardened 21-case browser run completed with all 33
  screenshots and reported 28 issues: missing visible Today state at collapsed
  widths, undersized More close targets, placeholder-only field names, and
  inspector dismissal failing after focus moved outside the non-modal panel.
- **GREEN — passed:** The final 21-case browser run completed with all 33
  screenshots and zero issues after the visible Today controls gained current
  and active state, More close targets reached `36px` on desktop and `44px` at
  collapsed widths, every exposed field gained an associated name, and one
  document-level inspector `Escape` handler restored focus across rerenders.
- **Evidence — passed:** The default QA server port is selected dynamically and
  the run waits for its own child process to announce the expected listener.
  The durable summary uses repository-relative paths, and all 33 referenced
  route/state screenshots exist beside it.
- The final source/implementation comparison, both focused composites, the
  responsive Today states, and the tablet/mobile More states were opened and
  visually reviewed after GREEN.

## Review gate

- **Initial result — blocked:** At `768x1000` and `390x844`, the fixed mobile
  header covered the More drawer title and focused close control, while the
  fixed bottom bar covered the drawer lower edge. A stricter browser pass
  against that unchanged layout completed all 21 cases and correctly reported
  22 interaction issues.
- **Final result — passed:** The responsive drawer and overlay now paint above
  fixed mobile chrome, the drawer owns a viewport-bounded scroll body, and the
  close control has an explicit token-based focus ring. The final browser pass
  completed 21 of 21 cases with zero issues.
- The strengthened audit now reaches interaction targets through keyboard Tab
  navigation and checks modal naming, open-state accessible names and overflow,
  modal Tab containment and `Escape`, viewport containment, `:focus-visible`,
  computed focus styling, and topmost hit testing for the header, close control,
  final tool, overlay, and lower drawer edge.

## Visual source and implementation evidence

- Approved source: `docs/audits/2026-07-20-focus-stack-qa/approved-focus-stack-target.png`
  (`1487x1058`).
- Machine-readable result: `docs/audits/2026-07-20-focus-stack-qa/summary.json`.
- Implementation screenshot:
  `docs/audits/2026-07-20-focus-stack-qa/desktop-reports-inspector-open.png`.
- Desktop More state:
  `docs/audits/2026-07-20-focus-stack-qa/desktop-reports-more-open.png`.
- Tablet More state:
  `docs/audits/2026-07-20-focus-stack-qa/tablet-reports-more-open.png`.
- Mobile More state:
  `docs/audits/2026-07-20-focus-stack-qa/mobile-reports-more-open.png`.
- Full same-canvas comparison:
  `docs/audits/2026-07-20-focus-stack-qa/comparison-full.png`.
- Shell-focused comparison:
  `docs/audits/2026-07-20-focus-stack-qa/comparison-shell-focus.png`.
- Primary-work/action comparison:
  `docs/audits/2026-07-20-focus-stack-qa/comparison-content-focus.png`.
- Comparison composition:
  `docs/audits/2026-07-20-focus-stack-qa/comparison.html`.

The same-canvas comparison normalizes the approved source and the rendered
Reports inspector-open state to `1440x1000`. The two focused comparisons isolate
the shell/inspector and primary action hierarchy so typography, column widths,
selected-state contrast, and control density can be judged at a readable scale.

## Viewports and states

The final browser pass covers seven direct routes at all three viewports:

| Viewport        | Size        | Routes and interaction states                                                                                                       |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Desktop         | `1440x1000` | Today, Reports, Source Collections, Tasks, Sessions, Developer Hub, Security; Today and Reports with inspector and More open states |
| Tablet boundary | `768x1000`  | Same seven routes and the same Today/Reports interaction states                                                                     |
| Mobile          | `390x844`   | Same seven routes and the same Today/Reports interaction states, including the four-action bottom bar                               |

The durable evidence retains the approved source, every one of the 33 route and
interaction screenshots referenced by the portable summary, and the
implementation state used by the comparisons. The More captures are taken after
the scroll body reaches its end, so the fixed **Workspace tools** header,
focused close ring, final **Audit** tool, and unobscured lower edge are visible
together. The final run completed 21 of 21 route/viewport cases, captured 33
screenshots, exercised six interaction cases, and reported zero issues.

## Comparison assessment

| Surface                 | Assessment                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography              | The implementation follows the target's compact sans-serif hierarchy and uses the existing product font stack. Headings, route cues, labels, and monospace status metadata remain readable without introducing a new font dependency.                                                             |
| Spacing and layout      | Rail, context, canvas, and inspector proportions follow the source direction. The canvas keeps a clear primary-work region; dense cards use consistent gaps and no audited viewport has document-level horizontal overflow.                                                                       |
| Colors and tokens       | Existing dark surfaces, borders, muted text, and cyan accent tokens reproduce the target hierarchy. Selected modes, primary review actions, focus rings, and warning/error states remain distinct.                                                                                                |
| Logo and icons          | The existing NanoCrab brand mark and product icon family are retained. No placeholder, emoji, ASCII, or invented image asset was added.                                                                                                                                                           |
| Copy and content        | Route labels are human-facing, including `Project chat`. Reports emphasize operator attention and approvals; source, task, session, developer, and security copy stays within existing API/product behavior.                                                                                      |
| States and interactions | Inspector and More are mutually exclusive, open controls expose live `aria-expanded`, close returns focus, and both layers support `Escape`. Inspector dismissal remains available after focus leaves its non-modal panel. The More modal Tab order wraps from close to **Audit** and back.       |
| Accessibility           | Every audited visible control has an associated accessible name without relying on placeholders, exactly one visible/runtime `main` exists, and the visible Today control exposes current and active state only on Today. Focused close controls expose a visible outline and topmost hit target. |
| Responsive behavior     | Desktop uses all four shell layers; the tablet boundary collapses safely; mobile uses a four-action bottom bar and bottom-sheet inspector. More close targets measure at least `36x36px` on desktop and `44x44px` at collapsed widths without horizontal overflow.                                |

## Findings and patches

| Severity     | Finding                                                                                                               | Patch and final evidence                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1           | Fixed mobile navigation covered the More drawer header and its focused close control at `768px` and `390px`.          | Responsive drawer and overlay layers now sit above the fixed header and bottom bar. Browser geometry and `elementFromPoint` checks prove the title and focused close control are rendered, within the viewport, and topmost.                                                         |
| P1           | The bottom bar obscured the More scroll viewport and final tools.                                                     | The drawer now spans `100dvh` with a bounded flex scroll body and safe-area-aware bottom padding. Scrolled-end captures show **Audit** and the lower edge above page chrome at tablet and mobile widths.                                                                             |
| P2           | The earlier interaction audit passed when DOM focus existed behind another layer.                                     | QA now uses natural Tab traversal where practical and verifies modal naming, focus containment, `Escape`, open-state control names, overflow, panel/header/body geometry, visible focus styling, and geometric hit targets. The unchanged layout failed before the production patch. |
| P1           | Direct Sessions could inherit the default Chat state rather than show its Code route context.                         | The shell distinguishes an explicit persisted choice from fallback state. A direct Sessions link now defaults to Code and still preserves an explicitly selected Chat, Cowork, or Code session context. Browser coverage passes at all three viewports.                              |
| P1           | Sessions summary controls used mismatched classes, exposing browser-default white blocks and weak hierarchy.          | Session command/stat classes and styles now align, including type controls, labels, contrast, hover, and focus states.                                                                                                                                                               |
| P1           | Developer Hub lane buttons could inherit low-contrast/default button typography.                                      | Lane cards explicitly use product text color and font, with product hover/focus treatment.                                                                                                                                                                                           |
| P1           | Security route/check/form groups collapsed into dense flex layouts at narrow widths.                                  | Security trust routes and checks use responsive card grids; the allowlist field has an explicit label.                                                                                                                                                                               |
| P2           | Report action cards were tall and visually equal, obscuring the approval priority.                                    | Actions are compact and full-span where needed; **Review approvals** is the cyan primary action.                                                                                                                                                                                     |
| P2           | Source Collections retry rendered as a browser-default button.                                                        | The retry action now uses existing compact ghost-button classes and keeps its loading/disabled behavior.                                                                                                                                                                             |
| P2           | Several Report, Tasks, and Security form controls lacked sufficient accessible names.                                 | Explicit labels were associated with the affected fields and verified by the rendered QA name audit.                                                                                                                                                                                 |
| P2           | The visible tablet/mobile Today brand lacked the current-page and active state carried by the hidden desktop control. | Both responsive Today controls now derive `aria-current` and active styling from the route; rendered selection evidence verifies the one visible control at every viewport.                                                                                                          |
| P2           | The More close glyph exposed only an approximately `13.734x18px` hit target.                                          | Its centred target is now `36x36px` on desktop and `44x44px` at collapsed widths, retaining the existing token focus ring and passing computed geometry checks.                                                                                                                      |
| P2           | Placeholder hints masked unassociated Report, briefing, Task operation, and Sessions search fields.                   | Placeholder text no longer satisfies the QA name audit; every exposed field has an explicit associated label or `aria-label`, and the final open- and closed-state audits report none unnamed.                                                                                       |
| P2           | Inspector `Escape` handling stopped when focus left the non-modal aside.                                              | One document-level handler checks only the live open inspector, closes it from outside focus, restores trigger focus, and is not duplicated by shell rerenders.                                                                                                                      |
| P3, resolved | A fixed default QA port could accept a stale listener from another process.                                           | The default port is dynamically selected, the spawned child must announce the expected URL, and child exit before readiness fails the run; explicit environment overrides remain supported.                                                                                          |
| P3, resolved | The committed summary used ignored absolute artifact paths and referenced missing durable screenshots.                | Summary paths are relative to the durable audit directory, all 33 referenced screenshots are committed beside it, and the portable existence contract passes.                                                                                                                        |
| P2           | Four Developer Hub lanes remained cramped in one row at `390px` because a later desktop rule won the cascade.         | A post-component responsive rule uses two columns at `<=768px`; the final mobile capture is readable and has no overflow.                                                                                                                                                            |
| P3, resolved | A Today More control mounted after the drawer opened could expose stale `aria-expanded`.                              | Newly rendered controls are resynchronized with the live drawer state; the open-before-render regression passes.                                                                                                                                                                     |
| P3, resolved | `project-chat` could expose an internal route ID/generic icon.                                                        | Navigation metadata now uses `Project chat` and the existing chat icon family.                                                                                                                                                                                                       |

## Residual P3 differences

- The approved concept uses slightly richer tonal depth and shadow texture than
  the production token set. The implementation keeps existing tokens to avoid a
  broad visual-system change in the shell-foundation slice.
- The source inspector depicts a denser live production timeline. Slice 1 uses
  existing route context, metrics, and alerts because unified-session behavior
  and new backend data are intentionally outside this issue.

These are intentional directional differences, not actionable correctness or
usability defects. No P0, P1, or P2 finding remains in the final rendered pass.

final result: passed
