---
name: terminalsight-ocr-validation
description: Validate TerminalSight route OCR, repeated text aggregation, scrolling LED fragments, and extra destinations when investigating missing or incorrect route labels.
---

# TerminalSight OCR Validation

Check how detected bus and UV Express signs become passenger route labels.
Follow the repository's AGENTS.md. All paths and commands below are relative
to the repository root, not this skill folder.

## Inspect the relevant path

- Read `docs/ocr-public-view.md` and `config/routes.json` for current behavior
  and configured crops, sampling intervals, and evidence thresholds.
- Trace crop and OCR problems through `backend/ocr/ocr_worker.py`; main route evidence
  through `backend/ocr/route_recognition.py`; extra destinations through `backend/ocr/route_details.py`.
- For stale labels, inspect session checks in `backend/state/occupancy.py`. For display-only
  issues, inspect `src/utils/publicDisplay.ts` and
  `src/components/views/PublicView.tsx`.

## Check route evidence

1. Establish whether the failure is vehicle detection, sign cropping, text
   reading, aggregation, or display formatting before proposing a change.
2. Check that the scan region covers the sign on the clean source frame.
   An OCR AREA - HOLD overlay indicates a retained region during occlusion;
   it does not prove a new OCR observation occurred.
3. Use `tests/test_ocr.py` to check repeated observations, weak or ambiguous
   evidence, expiry, route correction, and rejection of old-session results.
   Preserve confirmed routes during brief unreadable periods.
4. Check dynamic extra destinations using repeated, positioned text evidence.
   MA-A and NCCC are examples, not a fixed list to hard-code. Avoid accepting
   branding or duplicating the main route as an extra destination.
5. Distinguish synthetic scrolling-fragment tests from real LED footage.
   Passing a fragment test does not establish field accuracy. Route confidence
   is an aggregation score, not a calibrated probability.

## Run relevant checks

For OCR behavior and session-bound route checks:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_ocr.py -v
```

For passenger or driver route rendering changes:

```powershell
node --experimental-strip-types --test tests/public-display.test.mjs
```

When sample-video validation is requested and local assets are available,
inspect `scripts/test_sample_ocr.py` before running it. Check the actual crop
and recognized text; do not infer recognition from the overlay alone.

## Report

State the affected camera or fixture, observed versus expected route, checks
actually run, and any untested footage. For review-only requests, report findings
without changing thresholds or runtime code. For requested fixes, make a focused
change and rerun the affected checks. Never invent text for unreadable signs.
