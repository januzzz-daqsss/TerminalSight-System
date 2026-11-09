---
name: terminalsight-occupancy-checks
description: Validate TerminalSight bay occupancy, occlusion grace periods, vehicle sessions, and shared loading timers when investigating bay flicker, timer resets, or inconsistent public displays.
---

# TerminalSight Occupancy and Timer Checks

Check that one vehicle session drives bay status and timing across displays.
Follow the repository's AGENTS.md. All paths and commands below are relative
to the repository root, not this skill folder.

## Inspect the relevant path

- Read `backend/detection/detector.py` for vehicle-to-bay assignment and `backend/state/occupancy.py` for
  session identity, departure confirmation, replacement, and elapsed time.
- Read `config/routes.json` for the current departure grace period and
  `backend/server.py` for the shared `/api/bays` response and sample-loop reset.
- For display differences, trace `src/App.tsx`, `src/utils/publicDisplay.ts`,
  `src/components/views/PublicView.tsx`, and
  `src/components/views/PublicSignageView.tsx`.

## Check session behavior

1. Separate a missed detection from a confirmed departure. Current defaults
   are a five-second departure grace period and a 900-second loading limit;
   verify the current configuration before judging timing.
2. Confirm short occlusions preserve the session ID, timer, and recognized
   route. A confirmed departure, sustained replacement, or sample rewind must
   not transfer the previous vehicle's route or timer to a new session.
3. Preserve the bay overlap calculation: intersection area divided by bay
   polygon area, with the current 0.20 threshold. This is not box IoU.
4. Use deterministic `now` values in existing occupancy tests to check brief
   gaps, the exact departure threshold, late reacquisition, vehicle replacement,
   and loading-time boundaries. Do not wait 15 minutes to test timer logic.
5. Verify all displays consume server timing. At zero, the passenger status is
   DEPARTING; after the limit it is DELAYED for an overstaying bay. Public timers
   clamp at 00:00. Check stale-data indicators rather than presenting stale
   values as live.

## Run relevant checks

For occupancy sessions, occlusion, and route resets:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_ocr.py -v
```

For public status and timer rendering:

```powershell
node --experimental-strip-types --test tests/public-display.test.mjs
```

If the bay API or occupancy export is affected, also run:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_occupancy_export.py -v
```

Use temporary databases for tests. Do not reset `terminalsight.db` or alter
live timers to demonstrate an edge case. For requested playback checks, compare
Camera Zones, Dashboard, `/public-view`, and `/signage` for the same session.
Current sample polygons cover Bay 1 and Bay 6, not all ten displayed bays.

## Report

State the tested transition, expected and observed session/timer behavior,
checks actually run, and any remaining hardware or playback validation.
Review-only requests produce findings; requested fixes should extend existing
logic and tests. Do not claim automatic visit persistence from in-memory bay
state or successful CSV tests alone.
