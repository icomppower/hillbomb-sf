# HILLBOMB SF

A real-data downhill BMX race in San Francisco: from the Coit Tower terrace down the Filbert Steps, across
Montgomery and Sansome, and flat out along the Embarcadero to finish under the Ferry Building clock tower, against
three rival riders, with the marine layer rolling in off the bay mid-run.

**Play:** https://icomppower.github.io/hillbomb-sf/ (WebGPU: recent Chrome, Edge or Safari, including iOS 26)

- Course: OpenStreetMap ways traced into a 1 m centreline (`tools/route/`), heights from USGS 3DEP; buildings and
  landmarks from SF Bay Crossing's DataSF + Blender pipeline.
- Engine: SF Bay Crossing / Tidewater WebGPU + WGSL, no Three.js. Sim (`src/sim/`) is headless and deterministic.
- `npm run dev` · `npm run build` · `./verify.sh` (gates, SPEC §12) · `node tools/route/build.mjs` (route bake)

The design spec and status live in Notion. Credits and licences: `CREDITS.md`.
