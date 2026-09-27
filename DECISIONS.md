# Decisions

HILLBOMB SF, from the Notion build spec (page 3d71f269eaea819985a6d2518439924e). Deviations from the spec and
removals from the bay-crossing fork are logged here with a reason. bay-crossing's own decisions are archived in
`docs/bay-crossing/DECISIONS.md`.

## Fork removals (SPEC §1)

- **D1** Removed the ferry and boats: `src/player/{BoatController,BoatSpray,FerryAutopilot,FerryController,Player}.js`,
  `src/world/{BoatModel,FerryModel,FerrySpec}.js`, `src/world/boat/`, `src/ocean/WakeSim.js` (the wake needs a
  boat), `public/ferry/`, `tools/ferry/`, the boat lights and hull mask in `App.js`, their tests.
- **D2** Removed the Sausalito building tiles (the nine tiles i ≤ 2, j ≤ 4 in `public/buildings/`). The index lists
  them under `removed`; every kept tile is byte-identical to bay-crossing. `tools/buildings/build.mjs` would still
  rebuild them, so it stays as provenance only (the route never needs a building re-bake).
- **D3** Golden Gate Bridge and Alcatraz stay as distant backdrop at LOD2 only (LOD0/LOD1 files dropped;
  `public/landmarks/index.json` marks them `backdrop`; the loader clamps the level to what a landmark ships).
- **D4** Removed the fishing, swimming, beach, bird-song, whale and boat audio (39 files). Kept `wind`, `pier_lap`
  (water against the Embarcadero sea wall) and `gull`.
- **D5** Removed the tourist layer: waypoints, landmark signs, places (`Waypoints.js`, `Places.js`, `Signs.js`) and
  the bay-crossing UI (`src/ui/`: panel toolkit, boat gauges, walking help) and soundscape (`src/audio/`). The game
  has its own lean HUD and menus (`src/game/Hud.js`) and audio (`src/game/Audio.js`).
- **D6** bay-crossing's gates (`gates/g0..g7`), shots, keyart and run docs are removed or archived under
  `docs/bay-crossing/`; HILLBOMB's gates follow SPEC §12.

## Course (SPEC §2)

- **D7** The route is the shortest path over the OSM highway graph through 23 OSM via nodes (listed in
  `tools/route/build.mjs`, `VIAS`), with snap links of ≤ 3.5 m between unconnected nodes (sidewalk ends, crossings).
  Nothing is hand-drawn. The Embarcadero is reached over the mapped Greenwich St crossing to Herb Caen Way at Pier 23
  (the nearest mapped crossing to Filbert; the spec's "Pier 23 → Pier 1"), and the sprint rides Herb Caen Way, the
  waterfront promenade, south to the Ferry Building.
- **D8** Start and finish vs the landmark anchors. The Coit Tower model's base reaches 11.3 m north of its anchor and
  the Ferry Building model's west façade is 13.8 m from the clock-tower anchor, so a start or finish line within
  10 m of either anchor would sit inside the model. The grid is on the tower's north terrace (2 m clear of the base,
  tower directly behind, facing the bay) and the finish is on Herb Caen Way under the clock tower (5 m clear of the
  façade). G3 therefore measures start and finish against each landmark's ground-level footprint (the convex hull of
  its LOD0 mesh below ground + 12 m), not its centre point: within 10 m of the footprint, and the tower behind the
  start / beside the finish.
- **D9** The start: the terrace → the two short terrace flights → Telegraph Hill Blvd at the summit circle → the
  boulevard's descent round the east side of the summit to the top of the Filbert Steps. A lap of the parking circle
  was tried and dropped: the only OSM link from the terrace to the circle is the boulevard node the lap would exit
  by, so the line doubled back on itself for 4 m (a hairpin through the start grid). The boulevard's descent does go
  round the summit.
- **D10** Measured at first bake: 1,659 m, 87.5 m drop (89.4 → 2.0 m local MSL), 13 stair flights. The spec's
  expectation was 1.8–2.2 km / ≈ 80 m; the real line from the terrace is shorter once the corners are smoothed. The
  measured values are frozen in `SPEC-THRESHOLDS.md`.
- **D11** Curvature clamp: minimum radius max( 5 m, half-width + 2.5 m ), every violator smoothed per round. Where the
  OSM line makes a U-turn narrower than that (the switchback from Telegraph Hill Blvd onto the top of the Filbert Steps is
  ~6 m across) the smoothed line takes a chord across the slope inside it: the Blvd via node there ends up 20 m off the
  line. G3 reports the worst via distance but gates only what SPEC §12 names (start, finish, Filbert Steps endpoints).
- **D12** Walls: the bake stores the free distance to the nearest building (DataSF footprints + landmark hulls) on
  each side of every sample. Where a wall reaches into the corridor (the foot of the Filbert Steps runs hard along an
  apartment block) the centreline is pushed into the gap, narrowing the path only if the gap is narrower. The ribbon
  and the corridor limits never reach into a wall.
- **D13** Stair flights: maximal runs of OSM `highway=steps`, split at OSM way boundaries and at turns > 30° with a
  2.5 m landing; each flight is linear top → bottom with `step_count` risers (else 0.17 m). Kickers sit at the real
  features the spec lists, with the Embarcadero planters/benches every 110 m on alternating sides.
- **D14** The terrain is flattened to the ribbon at load (`src/game/TerrainFlatten.js`), not in the tiles, so the
  reused 3DEP tiles stay byte-identical to bay-crossing (G0).
- **D15** Parked cars: along the OSM Montgomery and Sansome street ways, against the kerb, ≥ 4 m clear of the
  corridor near the line. Street props: OSM lamps, benches and trees within 30 m; palms and lamps seeded along the
  promenade and streets where OSM maps none within 25 m.

## Ride model (SPEC §3)

- **D16** The Astra model is kept exactly (constants in `BIKE`), including pedal and brake applying in the air.
  Two readings made explicit: the wheel probes read the stair treads (`route.probe`), while the along-slope gravity,
  the ground velocity `gv` and the body floor read the smooth flight line, so a riser does not register as a 20 m/s
  vertical ground velocity (which would fire the impact-crash test on every step).
- **D17** Addition: the route's real corners. Holding a line through a bend takes v²κ of lateral grip, applied to the
  lateral velocity on the ground. Astra's track was straight; the SF line is not, and the AI's curvature-derived
  speed profile (§5) presumes corners matter.
- **D18** Addition: building walls. Past the hard limit on a side where the limit is a building wall, a glancing
  touch (< 2.5 m/s lateral) scrapes along the wall (speed scrub, bounce); a harder hit is a crash. Off the open side
  it is always a crash. On stairs and wooden landings the open-side margin is 1 m (railings, garden beds and drops),
  elsewhere 2.5 m.
- **D19** Wet factor is height-banded like the fog: ground below 45 m soaks up to twice as fast as the summit
  (`wetAt` in `race.js`). The marine layer is densest at the water.

## Race (SPEC §5, §6)

- **D20** The fog point: one of sections 2–6 uniformly, then a point inside it, triggered when the leading rider
  reaches it.
- **D21** AI tuning targets (measured over 30 seeds, `tools/sim`): NOB 0 % of runs with a crash, DOGPATCH 47 %
  (spec ≈ 35 %), SUTRO 57 % (spec ≈ 50 %), all finish, spread ≤ 25 % on the gate seeds. DOGPATCH's crashes come at the
  tight wet corner below the last flight rather than on the wooden flights themselves: the wooden flights are nearly
  straight, so speed alone does not throw a rider off them; the spec's "mostly on wet wood" holds only loosely.

## World additions

- **D22** The Bay Bridge West Span, for the skyline wide (SPEC §7 wants Coit Tower, the bay and the Bay Bridge in one
  frame; bay-crossing never modelled the bridge). The deck line is OSM (a second cached, checksummed, ODbL source:
  `data/raw/baybridge-osm.json`, fetched by `tools/landmarks/fetch-baybridge.mjs`); the layout is published span
  lengths, tower height and clearance (`tools/landmarks/baybridge.mjs` → `public/landmarks/bay-bridge.json`); built at
  load as one backdrop mesh (`src/world/BayBridge.js`). Most of it lies east of the terrain domain, over open water.
- **D23** Audio needs ffmpeg with libopus; this machine has none on PATH, so `ffmpeg-static` is a dev dependency
  (`tools/audio/lib.mjs` falls back to it). The game ships no runtime dependencies.
- **D24** Director calmed after play feedback ("they change angle for no reason" early on): the rival cam needs a real
  pass (≥ 1.5 m/s closing) and ≥ 12 s of racing, so the start bunch no longer trips it; the stair low-track covers
  only flights ≥ 20 m (the upper concrete and the long wooden flight); a cut back to the chase holds ≥ 6 s. First
  30 s: 9 cuts → 6.
