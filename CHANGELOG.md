# Changes

## Starbase (2026-10-30, decision G36)

The product is called **Starbase**. It was called Ground Control, and Feature Workshop before that (and "Dashboard" while the name wasn't decided). Nothing of yours has to be set up again: the first start moves everything over, and the old names keep working for one release.

**The command** is `starbase`. `ground-control` still works for one release: it says "ground-control is now called starbase" and runs the same command.

**Your files** are in `~/.starbase`. The first time Starbase starts (the service, `npm start`, or any `starbase` command):
- `~/.ground-control` is renamed to `~/.starbase`, on the same disk, so nothing is copied. A link by the old name is left behind, so a copy of Ground Control that is still running keeps finding its files. Where the link can't be made (Windows without the rights), a note, `MOVED-TO-STARBASE.txt`, is left in `~/.ground-control` instead. The audit log gets one line: "Moved ~/.ground-control to ~/.starbase".
- If both folders are already there, nothing is merged: Starbase uses `~/.starbase`, says once that it left `~/.ground-control` alone, and `starbase doctor` reminds you until you delete it.
- An older `~/.feature-workshop` (from before Ground Control) has its files moved across once, as before, with a `MOVED.txt` note left in it.

**The background service** is `com.moxie.starbase` on macOS, `starbase.service` on Linux and the task "Starbase" on Windows, logging to `~/.starbase/logs/starbase.log`. `starbase install` stops and removes the old `ground-control` service first (`com.moxie.ground-control`, `ground-control.service`, or the task "Ground Control"); `starbase doctor` says when an old one is still there. The install line removes the old `@moxie/ground-control` package before it installs `@moxie/starbase`.

**Environment variables** are `STARBASE_…` (for example `STARBASE_STATE_DIR`, `STARBASE_DEMO`, `STARBASE_FEATURES_DIR`, `STARBASE_DIR`, `STARBASE_USER`). Each old name (`WORKSHOP_…`, `GROUND_CONTROL_…`) is still read while its new name isn't set; `dashboard/lib/env-names.js` lists every pair. The hosted site's own settings on Vercel (`GOOGLE_CLIENT_ID`, `SITE_URL`, `DATABASE_URL` and the rest) are unchanged.

**A repository's profile** is `starbase.md` in its top folder; an older `ground-control.md` still counts.

**Saved tokens** (the Orbit token and the laptop's site token) are kept under Starbase's names in the Keychain or Credential Manager. A token saved under the old name is still read, and moved to the new name the next time it is saved.

**The page** sends its token as `X-Starbase-Token`; Starbase still takes the old `X-Workshop-Token`, so a page left open across the update keeps working.
