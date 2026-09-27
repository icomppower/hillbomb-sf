# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| G0 Data | PASS | 2026-09-27 | route + Bay Bridge OSM cached, checksummed, ODbL; 357 reused bay-crossing tiles match sha256; 5/5 negatives |
| G1 Clean fork | PASS | 2026-09-27 | removals, vite build, audit (no runtime deps), sky/bay/course/riders render headless; 8/8 negatives |
| G2 Route bake | PASS | 2026-09-27 | byte-identical ×2 offline = public/route; 1,659 m / 87.46 m frozen ±2 % / ±5 %; ≤ 0.48 m off terrain off the stairs; 4/4 |
| G3 Georeference | PASS | 2026-09-27 | start 5.9 m from Coit footprint (tower 2° astern), finish 5.3 m from Ferry Building, clock tower abeam; Filbert ends ≤ 7.6 m; 3/3 |
| G4 Ride | PASS | 2026-09-27 | autopilot 104.64 s (frozen 94.1–115.2); Montgomery backflip lands +20 boost; under-rotation crashes; 6.5 m flight gapped; 5/5 |
| G5 Race | PASS | 2026-09-27 | seeds 1–5: all finish, DOGPATCH 2 crashes, SUTRO 20–24 trick attempts/run, spread ≤ 25 %; 4/4 |
| G6 Weather | PASS | 2026-09-27 | lens 0.75 s, grip 0.95 → 0.54 by 17.75 s, clear 25.25 s after dry; 4/4 |
| G7 Director | PASS | 2026-09-27 | steps / air / skyline / finish in seed 1, cuts ≥ 4 s, deterministic; 5/5 |
| G8 Budget | PASS | 2026-09-27 | 53.8 fps p95 @1080p low (floor 46, calibrated at 58.7), 694 MB (cap 863), no swap; 3/3 negatives |
| G9 Baseline limits | PASS | 2026-09-27 | low / mobile / high × race / shots at WebGPU defaults; 6/6 |
| G10 Live | PASS | 2026-09-27 | icomppower.github.io/hillbomb-sf cold load: desktop 8 s, phone 4.5 s, both ride with a live HUD; 2/2 |

## Current

**DONE.** G0–G10 green in one clean `./verify.sh` run (2026-09-27T08:35Z, see `DONE`); live at
https://icomppower.github.io/hillbomb-sf/.

Known: G8 is sensitive to a shared machine. Quiet-machine runs measured 58.7 (calibration), 45.3, 52.3 and 53.8 fps
at p95 against the frozen floor of 46 (the spec target is 40); runs made while another session's headless Dawn gates
were running measured 33–34 fps. The floor was not changed. Run G8 with the GPU otherwise idle; if it keeps landing
near 46, recalibrating the floor from several runs needs the owner's approval.
