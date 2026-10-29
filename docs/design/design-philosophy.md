# Design philosophy: calm screens, depth on request

Written 2026-10-29, during packet R (look and feel), after the review of steps 1–2. It reads the current brief (`docs/plans/packets/R-look-and-feel.md`) and the step 2 screenshots, and compares them with what the best-built tools for dense information say in their own words.

How the changes are marked:
- **[In brief]**: already in the R brief; the research backs it.
- **[Refines brief]**: the brief has the idea; this sharpens it.
- **[New]**: not in the brief.

---

## 1. Summary

The developer's bar is a single Claude Code terminal: one place, one line of what is happening, one prompt to type into. The tools that handle a lot of information calmly (Linear, GitHub, Vercel, Sentry, Raycast) do the same few things:

- **They decide what matters first and push the rest back.** Linear's 2026 refresh says the parts "that support orientation and navigation should recede". NN/g says to show "everything that users frequently need up front", and no more.
- **They keep one layer of detail, labelled by what is in it.** NN/g finds that more than two levels "typically have low usability". Its information scent research shows that labels like "More" tell people little.
- **They never move what you were looking at.** Primer's first rule for showing and hiding is "Maintain context for users". Vercel's guidelines say skeletons "mirror final content exactly".
- **They show live agent work as one line of "now", with the full record folded.** GitHub's agent logs group "similar tool calls" and collapse a sub-agent's work "by default, with a heads-up display showing what it's working on right now".
- **They draw less.** Linear: "Structure should be felt not seen." Colour comes from a rule-built scale, and status colour is used sparingly.
- **They make the keyboard the fast path, and the screen teaches it.** Raycast shows the current actions with their keys in an action bar. Superhuman's command palette shows each command's shortcut "so users learn it for next time".

The brief already has most of the large rules: Simple and Full, nothing jumps, no browser look, the gallery. The biggest gaps the research shows are:

- one live "now" line per job and per crew member, with the full activity grouped and folded;
- a Space-bar peek, so a job can be read without leaving Jobs or the Desk;
- the Desk's Go / No go buttons in a fixed spot on every item;
- labels on every fold that say what is inside;
- no loading flicker: nothing for quick loads, and a short delay before any spinner;
- removing repeated titles and repeated "waiting" times;
- quieter navigation and colour.

---

## 2. Sources and what each one actually says

Quotes are short and taken from the page linked. Where I could not open a page, I say so.

### 2.1 Linear: the 2024 redesign and the 2026 refresh
- [How we redesigned the Linear UI (part II)](https://linear.app/now/how-we-redesigned-the-linear-ui), 2024
- [Behind the latest design refresh](https://linear.app/blog/behind-the-latest-design-refresh), 2026

2024 redesign:
- **Goal:** to "reduce visual noise, maintain visual alignment, and increase the hierarchy and density of navigation elements".
- **Colour:**
  - Themes moved to a colour model where equal steps look equal (LCH), "perpetually uniform".
  - Each theme is generated from three inputs (base colour, accent, contrast) instead of 98 hand-set values.
  - They reduced "how much chrome (blue in our case)" was used.
  - Text and neutral icons were made darker in light mode and lighter in dark mode.
- **Type:** a display cut of Inter for headings only, plain Inter everywhere else.
- **Testing:** each decision was stress-tested by view type (list, board, split) before it shipped.

2026 refresh:
- **Visual weight follows importance:** parts that help you get around "should recede". The sidebar was dimmed, because it stayed loud after you had already arrived.
- **Fixed places for actions:** header actions had drifted and "no longer appeared in predictable places", so their spots were fixed.
- **Fewer, smaller icons.** Coloured backgrounds behind team icons were removed.
- **Fewer lines:** dividers had multiplied without a clear purpose, contrast was softened, and "Structure should be felt not seen."
- **Keep the density, lose the weight:** "preserving that rich density of information without letting the interface feel overwhelming."
- **Success test:** if people don't notice what changed, the polish worked.

### 2.2 Linear: agent guidelines and product docs
- **[Agent Interaction Guidelines](https://linear.app/developers/aig):**
  - Agents "should clearly indicate whether they're thinking, waiting for input, executing, or finished working".
  - "Silence leads to uncertainty": give "immediate, but unobtrusive, feedback".
  - "Humans should be able to understand what's happening at a glance", and can look into the reasoning when they need to.
  - "When asked to disengage, an agent should step back, immediately."
  - The final responsibility stays with a person.
- **[Priority inbox](https://linear.app/changelog/2026-09-03-priority-inbox), 2026-09-03:** a Priority tab "separates what needs your attention from what can wait", so "a review blocking a release never gets buried".
- **[Display options](https://linear.app/docs/display-options):** you "choose what issue properties are displayed" on list rows and board cards. The choice can be saved "as personal preferences or as the default" for a view.
- **Peek:**
  - What it does: Space shows a focused issue's details without opening it, and J/K moves through the list while the peek stays open.
  - Caveat: I could not open [linear.app/docs/peek](https://linear.app/docs/peek) directly (404 to the fetch tool). This description comes from a search index of that page, so treat the exact keys as unconfirmed.

### 2.3 Vercel: Web Interface Guidelines
[vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines)
- **Layout and loading:**
  - "Skeletons mirror final content exactly to avoid layout shift."
  - "Set explicit image dimensions & reserve space."
  - Loading indicators get "a short show-delay (~150–300 ms) & a minimum visible time (~300–500 ms)" to avoid flicker.
  - "All states designed. Empty, sparse, dense, & error states."
  - "Update the UI immediately when success is likely; reconcile on server response."
- **Keyboard and focus:**
  - "All flows are keyboard-operable & follow the WAI-ARIA Authoring Patterns."
  - "Every focusable element shows a visible, unobscured focus ring."
- **Remembered state:**
  - "Persist state in the URL so share, refresh, Back/Forward navigation work."
  - "Scroll positions persist."
- **Motion:**
  - "Honor `prefers-reduced-motion`."
  - "Animations are cancelable by user input."
  - Prefer `transform` and `opacity`.
- **Details:**
  - `tabular-nums` for numbers.
  - "Child radius ≤ parent radius & concentric."
  - "Match visual & hit targets."
  - "Delay the first tooltip in a group."
- **A point against our direction:** it says "Prefer native elements" and gives advice on styling a native `<select>`. See section 5.

### 2.4 Vercel: Geist and the dashboard
- **[Geist colours](https://vercel.com/geist/colors):** every grey step has one job:
  - 100 default background, 200 hover background, 300 active background;
  - 400 default border, 500 hover border, 600 active border;
  - 900 secondary text, 1000 primary text.
- **[Geist materials](https://vercel.com/geist/materials):** a small, named set of surfaces:
  - on the page: base and small (radius 6), medium and large (radius 12);
  - floating: tooltip (lightest shadow), menu, modal, fullscreen (biggest lift).
- **[Navigation redesign](https://vercel.com/changelog/dashboard-navigation-redesign-rollout), 2026-02-26:** a sidebar that "can be hidden when not needed", "consistent tabs", and an "improved order" that "prioritized the most common developer workflows".
- **[Dashboard redesign](https://vercel.com/blog/dashboard-redesign), 2019:**
  - "The status of your deployment is now reflected in the tab icon."
  - Logs live inside the deployment view, filterable, and can be "copied to your clipboard in a single click".

### 2.5 Stripe: accessible colour systems
[Designing accessible color systems](https://stripe.com/blog/accessible-color-systems), 2019
- **The problem:** most default text colours missed WCAG's "minimum contrast ratio of 4.5 for small text".
- **The colour model:** a model where lightness is perceptually even (CIELAB), so "yellow has the same contrast range as blue".
- **Rules built into the scale:**
  - Colours are ordered by contrast, so two colours at least five levels apart are always readable as small text (four levels for icons and large text).
  - Every text colour also passes on the lightest tint of every hue.
- **Badges:** at the lightest level the hues were hard to tell apart, so both the badge background and its text moved up one level.

### 2.6 GitHub: Primer
- **[Progressive disclosure](https://primer.style/product/ui-patterns/progressive-disclosure):**
  - Use it sparingly, "only when it's necessary to truncate information".
  - First rule: "Maintain context for users", and don't throw people off where they were looking.
  - Pair the chevron with words, such as "Show more".
  - Text-only toggles are discouraged.
  - A caret is for menus, not for folding.
- **[Loading](https://primer.style/product/ui-patterns/loading):**
  - Under 1 second, "Don't show a loading state."
  - 1–3 seconds, an indeterminate indicator. 3–10 seconds, a determinate one if possible. Over 10 seconds, make it a background task.
  - "Avoid creating a jarring layout shift when the loaded content replaces the loading indicator."
  - "Show each item in a collection as soon as it loads."
- **[Empty states](https://primer.style/product/ui-patterns/empty-states):**
  - "Empty states should explain features *in addition* to conveying intention."
  - Use "one primary link or action".
  - For errors, the graphic "should not attempt to bring delight or be playful".
- **[Degraded experiences](https://primer.style/product/ui-patterns/degraded-experiences):**
  - "Replace the affected content with an error message"; replace whole panels with an empty state that says why.
  - "Never suppress rendering of the global navigation header."
  - Keep it to "5 or less outage messages" per page.
  - Don't imply that data was lost.
  - "Never disable an interactive control that is non-functional due to availability issues."
- **[Notification messaging](https://primer.style/product/ui-patterns/notification-messaging/):**
  - Inline messages sit next to the action they are about.
  - "Don't place messaging far from the user action."
  - In a dialog, show the message inside the dialog rather than closing it and showing a banner.
- **[Tooltip](https://primer.style/components/tooltip/rails/alpha):** "Use tooltips sparingly and as a last resort", and "never use tooltips to convey critical information".

### 2.7 GitHub: Copilot coding agent session logs
- [Agents tab and log redesign](https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository), 2026-01-26:
  - "Similar tool calls are grouped together."
  - "Tool outputs render inline previews."
  - Diffs expand "with one click".
  - "Every tool call has a distinctive icon."
- [More visibility into sessions](https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions/), 2026-03-19: a sub-agent's activity "is now collapsed by default", with "a heads-up display showing what it's working on right now", and can be expanded for the full output.
- This is the closest match anywhere to our Stage and our Job activity.

### 2.8 Sentry: issue details
[New issue details UI](https://sentry.io/changelog/new-issue-details-ui-now-available/), 2025-02-06
- **Two stated principles:** "a strong information hierarchy" and "progressive disclosure".
- **What progressive disclosure means for them:** "the user can choose what elements of the page they want to see."
- **How:** "Sections are collapsible, while tags, breadcrumbs, and activity can expand into drawers to help declutter the page." Workflow actions are grouped in one place.
- **Not covered:** the post does not say what is shown by default.

### 2.9 Raycast: "A fresh look and feel"
[raycast.com/blog/a-fresh-look-and-feel](https://raycast.com/blog/a-fresh-look-and-feel), 2022-07-19
- **One action bar:** actions, toasts and titles were combined "in an all-new action bar at the bottom of the window".
- **Shortcuts on show:** its right side lists the actions available right now, each with its key, to "learn action shortcuts".
- **Why:** the old action menu was "hidden behind a small button and is easy for new users to miss".
- **Messages in the window:** toasts moved inside the window, and a key expands a toast's details.
- **Icons:** one stroke width and corner rule for every icon.
- **Compact Mode:** an opt-in that blends the rest of the window into the background.

### 2.10 Superhuman: the command palette
[How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)
- **One shortcut:** opens and closes the palette, and focus returns to where it was.
- **It teaches:** every command shows its shortcut, so users learn it for next time.
- **Search that forgives:** fuzzy matching, plus synonyms shown as "Mark Done (Archive)".
- **Useful before typing:** commands have default ranks, and the ones that fit the current context are boosted.
- **Complete:** the palette is "the one place" for every command.
- A caveat: speed targets often attributed to Superhuman (50–100 ms) come from third-party write-ups, not from Superhuman's own pages, so I don't rely on them.

### 2.11 Apple Human Interface Guidelines
- **[Disclosure controls](https://developer.apple.com/design/human-interface-guidelines/disclosure-controls):**
  - "Use a disclosure control to hide details until they're relevant."
  - Put the most-used controls at the top "so they're always visible, with more advanced functionality hidden by default".
  - Labels should "indicate what is disclosed or hidden, like 'Advanced Options.'"
- **[Layout](https://developer.apple.com/design/human-interface-guidelines/layout):**
  - "Order content by relative importance": the most important items go near the top and leading side.
  - "Group related items", using "negative space, container shapes, or separator lines".
  - "Keep functionality the same as size classes change, and keep layout changes recognizable."

### 2.12 Nielsen Norman Group
- **[Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/):**
  - Show "everything that users frequently need up front".
  - Make the way into the detail easy to find, "in a clearly visible spot".
  - Labels should set clear expectations of what is behind them.
  - More than two levels "typically have low usability".
  - Step-by-step flows (wizards) are "problematic when the steps are interdependent and users must alternate between them".
- **[Information scent](https://www.nngroup.com/articles/information-scent/):**
  - A link's label should be "a succinct yet accurate description" of what is behind it.
  - Generic labels like "More" or "Learn more" give weak scent.
  - "Jargon, branded terms, or simply too sophisticated words may end up ignored."
- **[Skeleton screens](https://www.nngroup.com/articles/skeleton-screens/):**
  - Under 1 second, show nothing.
  - Skeletons for full-page loads under 10 seconds; spinners for one card or module; progress bars for longer waits.
  - A skeleton should be a wireframe of the real layout, not just a frame.
- **[Animation duration](https://www.nngroup.com/articles/animation-duration/):**
  - Most animations take 100–500 ms; about 100 ms for small feedback, 200–300 ms for a dialog.
  - Ease-out by default.
  - Entering takes a little longer than leaving.
  - Animations "are more often too long than too short".
  - The more often an animation is seen, the shorter and subtler it should be.
  - Hover animations may need a slight delay.

### 2.13 web.dev: Cumulative Layout Shift
[web.dev/articles/cls](https://web.dev/articles/cls)
- **Shifts you cause are fine:** shifts that respond to a click or keypress "are generally fine, as long as the shift occurs close enough to the interaction that the relationship is clear".
- **Shifts you didn't cause are the problem:** shifts within 500 ms of input are excluded from the score.
- **Slow requests:** "create some space right away and show a loading indicator" so later content doesn't push things around.

### 2.14 IBM Carbon: spacing and table density
- **[Spacing](https://carbondesignsystem.com/elements/spacing/overview/):**
  - "Sections of a UI are allowed to be dense, but the whole page should not be crowded."
  - The scale is built on multiples of 2, 4 and 8, and "deviating from the spacing scales should be avoided".
- **[Data table](https://carbondesignsystem.com/components/data-table/usage/):** row heights of 24, 32, 40, 48 and 64 px. The tallest is only for cells that wrap to two lines. Row size is a user preference.

### 2.15 Grafana: dashboards
- **[Best practices](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/best-practices/):**
  - "Dashboards should reduce cognitive load, not add to it."
  - "A dashboard should tell a story or answer a question."
  - "Avoid dashboard sprawl."
  - "Expressive charts with meaningful use of color."
- **[Dynamic dashboards](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/create-dynamic-dashboard):**
  - Rules hide panels based on variables or on whether a panel has data.
  - These rules only work in "Auto grid", where "Panels resize and fit automatically", which means the remaining panels move into the gap.
  - The docs don't say this outright, but it follows from how the grid works. It is the opposite of our "nothing jumps" rule; see section 5.

### 2.16 Refactoring UI (Wathan and Schoger)
- **[Labels are a last resort](https://www.refactoringui.com/previews/labels-are-a-last-resort):**
  - "In a lot of situations, you can tell what a piece of data is just by looking at the format."
  - Combine label and value ("12 left in stock").
  - "The data itself is what matters, the label is just there for clarity."
- **[Building your color palette](https://www.refactoringui.com/previews/building-your-color-palette):**
  - "8-10 shades" of grey.
  - Status colours "should be used pretty sparingly throughout the UI."

**Looked at and left out:**
- **Things 3, Height, Plain, Arc, Notion:** I found no first-party design writing concrete enough to quote.
- **Atlassian:** its lozenge (status chip) page is marked for deprecation, with thin guidance.
- **Datadog:** its [group widget](https://docs.datadoghq.com/dashboards/widgets/group/) docs only confirm that groups have a header and "can be collapsed".
- **Stripe's Sail:** not public.

---

## 3. Our design philosophy

Fourteen principles. Each one has a rule, why it matters, its sources, and a do / don't for the app.

### 1. Lead with "now, needs you, next"
- **Rule:** every screen opens on what is happening, what needs you, and the one next action; everything else waits.
- **Why:** this is the terminal's gift: one prompt, one current line. Showing what's needed most and holding the rest back is NN/g's first rule and Apple's layout rule.
- **Sources:** NN/g progressive disclosure; Apple Layout ("Order content by relative importance"); Linear 2026 (things that help you get around "should recede").
- **Do:** a Jobs card shows its title, one line, the state chip and the time.
- **Don't:** a coloured dot, seven stop icons, a chip and a status line on every card, all saying the same thing.

### 2. One layer of detail, never folds inside folds
- **Rule:** a screen and one layer of detail. The detail opens as a side sheet or in place below, and has no further folds except long text.
- **Why:** NN/g finds that more than two levels "typically have low usability", and three folds in one card is a maze.
- **Sources:** NN/g progressive disclosure; Primer ("use sparingly").
- **Do:** the Desk card has a single "Details" that opens a sheet with the Foreman's brief, how this works and adjusting the next step, as sections.
- **Don't:** "The Foreman's brief ▸", "Adjust the next step ▸" and "How this works ▸" stacked inside one card (today's Desk).

### 3. Every fold says what's behind it
- **Rule:** fold and link labels name their contents and, where useful, a count. Tooltips only add to what's on screen.
- **Why:** "More" has weak scent. Labels that name what's hidden let people decide without clicking. Tooltips are missed and don't work on touch.
- **Sources:** NN/g information scent; Apple ("Advanced Options"); Primer progressive disclosure (chevron plus words) and tooltip ("never ... critical information").
- **Do:** "Activity · 14 steps", "Facts: branch, model, cost", "Earlier messages (4)", "More graphs (7)".
- **Don't:** a bare "More", a bare "▸", or a status that only shows on hover.

### 4. Nothing moves that you didn't move
- **Rule:** an item may grow or shrink in place when you fold it. Nothing else moves: not the other columns, not the items above, and nothing at all because data arrived.
- **Why:** if things move unasked, the developer has to re-read the screen from scratch, which he named as the problem. web.dev draws the same line: a shift caused by your own click and next to it is fine; an unexpected one is not.
- **Sources:** web.dev CLS; Primer ("Maintain context for users"; "Avoid creating a jarring layout shift"); Vercel ("reserve space"; skeletons "mirror final content exactly").
- **Do:**
  - Hidden graphs leave a slim placeholder.
  - Arriving data fills a space already reserved.
  - A job that changes lane waits until the pointer leaves the card, then moves with a short animation that shows where it went.
- **Don't:**
  - a grid that reflows when one panel hides;
  - a banner that appears and pushes the lanes down.

### 5. Don't flash loading
- **Rule:**
  - Nothing for loads under about 1 second.
  - A 150–300 ms delay before any indicator, then at least 300–500 ms on screen.
  - Skeletons the same shape as the content; spinners only for one card.
- **Why:** a spinner that blinks for 200 ms makes the app feel slower and nervous. A calm app looks like it already knew.
- **Sources:** Primer Loading; NN/g Skeleton screens; Vercel guidelines.
- **Do:** switching from Jobs to the Desk shows the Desk immediately with its last known queue; fresh data fills in quietly.
- **Don't:** a full-page spinner or an empty white page between screens.

### 6. The work is loud; the frame is quiet
- **Rule:** the top bar, page headers and helper links sit a step quieter than the content: lighter text, no fills, fewer icons. Actions sit in the same place on every screen.
- **Why:** Linear dimmed its sidebar because it stayed loud after you had already arrived, and fixed header actions that "no longer appeared in predictable places".
- **Sources:** Linear 2026 and 2024; Vercel navigation ("improved order" by most common workflow).
- **Do:** "How it works" in the same top-right place on every page, in quiet text.
- **Don't:** an amber count, a green "Live" dot and a "Demo" pill all competing in the top bar.

### 7. Draw less: space before lines, one box deep
- **Rule:** group with space first, a divider second, a box last. Never more than one framed box deep. Dense sections are fine; a crowded page is not.
- **Why:** every border is something more to read. "Structure should be felt not seen."
- **Sources:** Linear 2026; Carbon spacing ("the whole page should not be crowded"); Apple Layout (group with "negative space").
- **Do:** Inbox's three setup steps as a numbered list on the page.
- **Don't:**
  - three boxed cards inside a page;
  - the stop map in its own framed card above a framed bar above a framed brief (today's Job).

### 8. Colour by rule, status colour only where status lives
- **Rule:**
  - One grey family with a named job per step.
  - One accent.
  - Status colours only in chips, dots and the stop map, built so each tint reads the same.
  - Data stays stronger than its label.
- **Why:** colour picked by eye drifts between themes. Status colour spread everywhere stops meaning anything.
- **Sources:** Geist colours (each step's job); Stripe (even-lightness scale, levels apart, badges moved up a level); Linear 2024 (less chrome colour); Refactoring UI (8–10 greys; status colour "sparingly"; labels are a last resort).
- **Do:** greys 100–1000 with Geist-style roles, and status chips that pass 4.5:1 in every theme.
- **Don't:** the Desk queue's brown, purple, teal and green dots, whose meaning is never said.

### 9. Live work is one line of "now"; the record is grouped and folded
- **Rule:**
  - Each job and each crew member shows a single current line (what, and for how long).
  - The full activity is grouped by kind (reads, edits, commands), with a count, and opens on request.
  - Errors and questions break out of the fold.
- **Why:** this is exactly what a terminal gives, a current line, and exactly what GitHub chose for agent logs. Linear's agent guidelines ask for state "at a glance".
- **Sources:** GitHub Copilot logs (grouped calls; sub-agents "collapsed by default, with a heads-up display"); Linear Agent Interaction Guidelines; Vercel (logs inside the deployment; copy in one click).
- **Do:** "Tester · running `npm test` · 2m", then "Activity · 31 steps (12 reads, 9 edits, 10 commands)".
- **Don't:** a scrolling feed of every tool call on the main screen.

### 10. Peek before you open
- **Rule:** from any list (Jobs, Desk queue, Inbox, Stacks), Space or a click on the card's preview opens a side sheet over the list's right side. j / k move through the list; Esc closes it and the list hasn't moved.
- **Why:** reading a job shouldn't cost you your place. Linear's peek and Sentry's drawers both keep the page and lay detail over it.
- **Sources:** Linear Peek (via search index; see 2.2); Sentry issue details (drawers); Primer ("Maintain context").
- **Do:** a sheet showing the job's ask, its now line and the next action, with Go / No go when it is waiting.
- **Don't:** opening the full Job page just to see why a card says "Question".

### 11. The keyboard is the fast path, and the screen teaches it
- **Rule:**
  - Every action is in the command box (⌘K) with its key shown.
  - The current screen's two or three actions sit in one consistent place with their keys.
  - Key hints elsewhere stay quiet until hover, focus or holding `?`.
- **Why:** the developer lives in a terminal; keys are home. Showing keys where actions are listed teaches them without cluttering every button.
- **Sources:** Raycast (action bar with keys; the hidden menu "easy for new users to miss"); Superhuman (one shortcut, shows each command's key, synonyms, context ranking); Vercel ("All flows are keyboard-operable").
- **Do:** the command box offers "Go: approve and start Test · a" when a decision is open, ranked first.
- **Don't:** a boxed key on every button.

### 12. Every state is designed, and failures stay small
- **Rule:**
  - **Empty:** explains the feature and offers one action.
  - **Error:** replaces only the part that failed, says why and that nothing was lost, and leaves the rest working.
  - **Connection:** shown only when broken.
  - **Controls:** never silently disabled.
- **Why:** calm is mostly about what happens when things go wrong: failed checks, conflicts, a lost connection. The memory note on new users and unhappy paths asks for this too.
- **Sources:** Primer (Empty states; Degraded experiences: "replace the affected content", "Never suppress ... the global navigation", at most 5 messages); Vercel ("All states designed").
- **Do:** a failed check on a card shows "Checks failing: `lint` · Fix" in its own space.
- **Don't:** a red page-wide banner, or a whole page that goes blank because GitHub didn't answer.

### 13. Motion explains, briefly
- **Rule:**
  - 100–160 ms for small feedback; up to about 220 ms for sheets.
  - Ease-out. Entering a little slower than leaving.
  - Only `transform` and `opacity`. Cancelled by any input. None with reduced motion.
  - Motion is used only to show where something came from or went.
- **Why:** NN/g finds animations are "more often too long than too short", and frequent ones must be shortest.
- **Sources:** NN/g Animation duration; Vercel guidelines.
- **Do:** a sheet slides in 8 px and fades in 200 ms, and out in 140 ms.
- **Don't:** cards bouncing as data refreshes.

### 14. The app remembers how you left it
- **Rule:** folds, hidden graphs, the Detail level, the open sheet and scroll position are remembered per screen. Anything worth sharing or going back to (a job, an open sheet, a Telemetry range) is in the address.
- **Why:** reopening the same folds every time is noise. Back should go back.
- **Sources:** Linear display options (saved "as personal preferences"); Vercel ("Persist state in the URL", "Scroll positions persist").
- **Do:** `#/jobs?peek=customer-merge` reopens the peek.
- **Don't:** Telemetry forgetting a hidden graph on reload, or Back losing the Desk's place in the queue.

---

## 4. Changes per screen

Compared with the brief and the step 2 screenshots (Light, 1512 px).

### Top bar
1. **[In brief]** Hide "Live" while connected; show a quiet "Reconnecting…" only when not. Make "Demo" a small label beside the name.
   - Today "Demo" sits in the nav row and looks like a tab you can click.
2. **[New]** Give the Desk count a neutral pill (grey text on a light grey tint), not amber. Amber belongs to the Needs-you state on the page; in the frame it competes with the work. (Principles 6 and 8.)
3. **[New]** Order the nav by daily use: Jobs, Desk, Inbox, Stacks, Telemetry. Today Inbox is first, though it is empty or rarely used. Vercel reordered by "most common developer workflows". (Principle 6.)
4. **[New]** Add a quiet "Search or run a command · ⌘K" field (or a ⌘K button) in the top bar, so the command box can be found. Raycast found that a hidden action menu is "easy for new users to miss". (Principle 11.)
5. **[Refines brief]** Put "How it works" in one fixed spot on every page, the page header's right end, in quiet text. Today it shifts: on Settings it is missing, and on the stop page it sits after the previous / next buttons.

### Jobs
1. **[In brief]** Each card: title, one status line, state chip, time. Stop dots only on hover, focus or in Full.
2. **[Refines brief]** Also drop the dot before each title. It repeats the chip, which already has a word and an icon. (Principles 1 and 8.)
3. **[Refines brief]** Make the Needs-you banner a single fixed-height line: "Customer notes tab has waited longest (5h) · 12 need you · Open". Today it is two lines and a big icon. It always takes the same space, even when nothing waits ("Nothing needs you" in quiet text), so the lanes never move. (Principles 1 and 4.)
4. **[New]** Peek: Space or a click on a card's empty area opens a side sheet on the right, over the last lane. It shows the ask, the now line and the actions (Go / No go when waiting). j / k move through cards. The full Job is one click or ↵ away. (Principle 10.)
5. **[Refines brief]** A job that changes lane while the pointer is over it waits, then moves with a 200 ms slide, so the eye sees where it went. Lanes otherwise never reorder. (Principles 4 and 13.)
6. **[Refines brief]** Show "GitHub checked 3 min ago · Check now" in the header only when the check is older than about 10 minutes or failed. Otherwise it lives in the command box and in Details. (Principles 6 and 12.)
7. **[Refines brief]** An empty lane is one quiet line under its heading ("None right now"), not a dashed box. (Principle 7.)
8. **[New]** A card with failing checks or a merge conflict says so in its status line, with one action ("Checks failing: lint · Fix", "Conflicts with main · Resolve"), in the card's own space. (Principle 12.)

### Desk
1. **[In brief]** The decision first, with the Foreman's brief folded.
2. **[Refines brief]** One "Details" per card instead of three folds. Today "The Foreman's brief", "Adjust the next step" and "How this works" are separate folds in one card. Details opens a sheet with these as sections. (Principles 2 and 3.)
3. **[New]** Fix the action row (Reply, No go, Go) at the same place for every item, the bottom of a card with a steady height, with the brief scrolling inside. After a decision, the next item's buttons sit exactly where the hand already is. Linear fixed actions that "no longer appeared in predictable places". (Principles 4 and 6.)
4. **[New]** Show each time once. Today "waiting 5h" is in the card header and again in the brief row, next to "parked 4h". (Principle 1.)
5. **[New]** Drop or explain the queue's coloured dots (brown, purple, teal, green). If they mean the stop, use the stop's icon. Otherwise remove them. (Principle 8.)
6. **[Refines brief]** "Decided today" shows one quiet line when empty ("Nothing decided yet"), not a box of explanation. (Principles 7 and 12.)
7. **[New]** After Go or No go, the next item appears at once, with an "Undo · z" note for about 5 seconds near the buttons. This applies only to steps that can be taken back; Merge and other actions that can't are never shown as done early. (Vercel: "Update the UI immediately when success is likely"; Primer: messages near the action. Principles 5 and 12.) It needs the server to accept an undo; if it can't, leave this out.

### Job
1. **[In brief]** The go / no go bar, the brief's summary and questions, and the message box first. The conversation shows the newest message and "Earlier (n)". Activity and facts fold into Details.
2. **[Refines brief]** Make the stop map a thin strip (about 32 px, icons and the current stop's name) on the header line, not a framed card about 90 px tall. The full labelled map is in Details. (Principles 1 and 7.)
3. **[New]** Say the title once. Today "Customer merge · plan v2 ready" appears in the page title area, the go / no go bar and the brief's heading. The bar carries the ask; the brief starts at its questions. (Principle 1.)
4. **[New]** Add a now line at the top of the right column: "Foreman · waiting for you · 35m", or "Builder · editing `merge.ts` · 2m". Activity comes below as "Activity · n steps", grouped by kind, folded. Questions and errors always show outside the fold. (Principle 9.)
5. **[Refines brief]** Pin the message box to the bottom of the right column, like a terminal prompt, with the model choice and Send on one 34 px row. Today it floats mid-column, and Send looks switched off when empty. Make it a quiet button that is still clearly a button. (Principles 1 and 11.)
6. **[Refines brief]** Move "L3 Large" and the "This job" facts into Details. In the header, keep only the state chip beside the title. (Principle 1.)
7. **[New]** Keep "1 decision made for you · review" as a pattern for every place the Foreman picked a default. It is a good example of showing the summary and letting you open the rest.

### Stage (the crew, and each stop's page)
1. **[In brief]** Show the crew member at work and what it is doing now, with its log on request.
2. **[Refines brief]** One row per crew member: icon, name, now line, time. Only one row's log opens at a time, below the row in its own column. The log is grouped (reads, edits, commands, each with a count), with diffs that open in one click and a "Copy" for the log. (GitHub agent logs. Principle 9.)
3. **[New]** On a stop's page (the step 2 screenshot), keep the go / no go bar but don't repeat the whole brief and questions from the Job page. Link "Answer on the job ›" or show them read-only and folded. Today the same questions and composer appear on both pages. (Principles 1 and 2.)
4. **[New]** A stuck or failed crew member breaks out of the list with its error's first line and one action (Retry, Ask the Foreman). The rest stay quiet. (Principle 12.)

### Stacks
1. **[In brief]** List on the left, the stack on the right on wide windows.
2. **[New]** Put words beside the progress dots: "2 of 21 merged". Today four dots stand for 21 parts and say nothing exact. (Principles 3 and 8.)
3. **[New]** Inside a stack: the parts in order, the next part to merge highlighted with its one action, and parts already merged folded into "Merged (n)". (Principles 1 and 2.)

### Inbox
1. **[Refines brief]** In the setup state, make the three steps a numbered list on the page, not three boxed cards. Use the UI font for "1 of 3"; today it is monospace, a leftover against the type rule. Keep the single primary action. Primer's empty-state guidance fits what is already there. (Principles 7 and 12.)
2. **[New]** With tickets: split them into "Needs a decision" and "Can wait", the way Linear's Priority tab does, and open tickets in a peek with Space. Each ticket's one action is "Start a job". (Principles 1 and 10.)

### Telemetry
1. **[In brief]** The dials, "Who used this week's limit" and the three graphs with the most to say, then "More graphs (7)". Hiding leaves a slim placeholder.
2. **[Refines brief]** Cut "Who used this week's limit" to a single sentence. Put the paragraph on how "other use" is estimated behind "How this is worked out". (Principles 2 and 3.)
3. **[New]** Show "What to do" only when there is something to do. Today every card has a tinted box, some saying "Nothing to do yet". (Principle 1.)
4. **[New]** Replace the three controls on each card (Table, Fold, Hide) with one "⋯" menu on the card's header, shown on hover and focus. Table becomes a "Chart / Table" switch in the same spot. Across ten cards that removes about twenty controls. (Primer: a kebab for menus. Principles 6 and 7.)
5. **[Refines brief]** When there are no readings, say so once, in the reserved space of the dials row, with "Read now". Each graph then shows a quiet one-line empty state of the same height ("Fills in after a few readings"), not its own long explanation. (Principles 4 and 12.)
6. **[New]** In charts, use one accent series with the others in grey. Status colour only for limits and warnings. Every number in tabular figures (the brief already has tabular figures). (Grafana: meaningful colour; Refactoring UI. Principle 8.)

### Settings
1. **[In brief]** Each section shows its main choices first, then more. Detail: Simple (default) / Full in Look.
2. **[Refines brief]** Name what's in "More": "More: Desk layout, text size, play". (Principle 3.)
3. **[Refines brief]** Under Theme, show Light, Default and Follow the system first, then "All themes (9)". Today nine tiles fill the first screen of Look. (Principle 1.)
4. **[New]** Changes apply at once, with a quiet "Saved" next to the control that fades after about 1.5 s. No page-level toast, no Save button. ([Primer Saving](https://primer.style/product/ui-patterns/saving): changes shown "accurately, quickly, and obviously"; Primer notification messaging: messages near the action.)
5. **[Refines brief]** Move the keys footer in the left rail ("j The next section · k …") into the `?` keys sheet. (Principle 11.)
6. **[Refines brief]** Settings uses the same full-width frame and gutters as other pages. Today it starts about 246 px in, a centred leftover. The rail sits at the left gutter; running text keeps about 75 characters.

### The pull-request review panel
1. **[New]** Put a single status line on top: "Round 2 · 3 comments to answer · checks passing", with the one next action ("Send to the agent", "Merge"). (Principle 1.)
2. **[New]** Group comments by file, folded, with counts. Answered ones fold into "Answered (n)". (Principles 2 and 9.)
3. **[New]** Give each unhappy path its own designed state in the panel's own space, with one action:
   - **failed checks:** the check's name and the first line of its error, the full log folded, "Ask the agent to fix";
   - **conflicts:** "Conflicts with main in 2 files · Ask the agent to resolve";
   - **changes requested after a round:** "New round: 2 changes requested". (Principle 12; the memory note on unhappy paths.)
4. **[Refines brief]** The GitHub check line stays tucked in, as Q designed it. It shows outside the panel only when it fails.

---

## 5. Things we deliberately don't take

- **Native controls (Vercel's "Prefer native elements").** The developer asked for no browser or Mac look anywhere, and the brief follows him. The cost Vercel warns about is keyboard and screen-reader behaviour. So our own Select, Choice and Tooltip must follow the [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/patterns/) patterns, which Vercel's guidelines also name: arrow keys, type-ahead, Esc, and focus returning to where it was. The gallery should show these.
- **Grafana's auto grid that closes gaps when a panel hides.** It is the exact jump the developer dislikes. We keep the slim placeholder.
- **Linear's and Carbon's tightest density (24–32 px rows, small type).** The developer asked for less clutter, not more on screen. We keep 14 px body text and 34 px controls; Full mode is the dense option.
- **A third density (Raycast's Compact Mode).** Simple and Full are enough. A third choice is one more thing to understand.
- **Peek by keyboard only.** Linear's peek reportedly works only from the keyboard. We also open it by click, because the app has to explain itself to new users.
- **Speed numbers attributed to Superhuman.** The 50–100 ms targets come from third-party write-ups, not Superhuman, so we don't quote them. Our bar is Primer's: no loading state under a second.
- **Toasts as the main way to say something happened.** Primer steers to messages next to the action. We use inline notes such as "Saved" and "Undo" near the control.
- **Showing as done early for steps that can't be taken back.** Vercel's "update immediately" applies only when success is likely and the step can be undone. Merge, close and send-to-GitHub wait for the real answer.
- **Dashboards people build themselves.** Grafana warns against "dashboard sprawl". Telemetry's graphs are a fixed set, with hide and fold, not drag and build.
- **A theme generator from three inputs (Linear 2024).** It is a good idea, but too big for this packet. We take the lesson (an even-lightness scale and set contrast steps) and leave the generator for later.
- **Step-by-step wizards for a job.** NN/g warns they are "problematic when the steps are interdependent", and a job's stops send work back and forth. The stop map stays a map.
- **Sidebar navigation (Vercel 2026, Linear).** With eight sections and a full-width brief, the top bar's single row costs less width than a sidebar. Revisit if the sections grow.
