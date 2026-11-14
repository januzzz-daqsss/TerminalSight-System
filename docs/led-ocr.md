# Experimental scrolling LED OCR

Static OCR remains the default. Enable the complementary path explicitly before
starting Flask:

```powershell
$env:TERMINALSIGHT_LED_OCR="1"
$env:TERMINALSIGHT_OCR_DEBUG="1"
.\.venv\Scripts\python.exe -B app.py
```

Restart without the LED override (or set it to `0`) to use static OCR alone.
No new packages, weights or route vocabulary are installed.

For Bus detections only, the existing vehicle-relative sign crop is searched for
horizontal red-dominant regions. A candidate is a heuristic, not proof of an LED
sign. The tighter crop receives red-channel contrast, mild smoothing, CLAHE and
polarity inversion. Static OCR runs first; LED failure leaves its result intact.
No images are superimposed and no vehicle motion is inferred.

The existing single OCR worker runs at most one additional pass per bay per three
seconds. There are at most ten session entries, four crops per entry, and eight
diagnostic reads per entry. Crops are bounded to 640 by 128 pixels. No inference
runs while holding the camera submission lock. Session changes reset evidence;
explicit camera discard invalidates late LED results. Occupancy still rejects all
OCR results whose session ID no longer matches.

Static and LED text from a sampled frame contribute one temporal observation,
not two independent votes. Existing score/support thresholds remain unchanged.
Existing temporal route matching combines observed character coverage irrespective
of fragment arrival order. Diagnostics additionally join uniquely overlapping
fragments in either order (minimum three shared characters). Joined strings are
never replayed into recognition as new evidence. Vocabulary validates observations;
no route comes from a bay number. LED crop coordinates are not used for extra
destination layout matching because their coordinate system differs from the
static crop.

With OCR debug enabled, the existing authenticated `/api/ocr/debug` endpoint adds
`led` records: actual accepted fragment text, mean OCR confidence, sample processing
time (monotonic seconds), recognition duration, crop bounds within the static crop,
and optional overlapping text. Empty text denotes no accepted recognition, not a
guessed destination. Diagnostics are bounded in memory and never sent to public
health endpoints or persisted in SQLite.

## Real footage comparison, November 14, 2026

```powershell
.\.venv\Scripts\python.exe -B scripts/check_led_ocr.py
```

This uses YOLO CPU without saving model selection, the actual Bays 2-5.mp4 video
and bays-2-5.json, real installed RapidOCR, and isolated in-memory occupancy.
It writes evidence only under ignored `tmp/led-review/` and never starts Flask.

Eleven source times (0–30 seconds, three-second spacing) yielded twelve eligible
assigned-vehicle observations. Eight enhanced candidate passes returned **zero
accepted text fragments**. Their recognition times were 360–791 ms, median 672 ms,
on this desktop. Both static and combined paths confirmed Panabo - Davao for Bay 4
at six seconds from actual DAVAO reads. Neither confirmed a Bay 5 LED route.
This is a recognition failure for the tested LED samples, not an accuracy gain.

Saved Bay 5 crops visibly include the red display, with fragmented/saturated
letter shapes. Bay 4 also produced non-sign red candidates. The method cannot
recover characters absent from the decoded image. The existing detector classified
some buses as UV Express, so those observations did not enter the Bus-only LED
path; classification was not silently changed. A separate close-up recording with
readable ground truth is needed to assess scrolling direction, fading, and route
accuracy. No claim is made for untested frames, all LED signs, or ThinkPad speed.

Tests distinguish synthetic fragment/crop checks from actual-video geometry
checks. The real-frame comparison is reproducible but not a labeled accuracy
benchmark. Inspect `results.json`, `Bay_4-led.png`, and `Bay_5-led.png` before
deciding whether to enable this experimental path for a rehearsal.
