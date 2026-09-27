# Credits

The code in this repository is released under the MIT license (see `LICENSE`). Third-party assets keep their own
licences.

## HILLBOMB SF

A fork of [SF Bay Crossing](https://github.com/icomppower/bay-crossing) (MIT), itself a fork of
[Tidewater](https://github.com/dgreenheck/tidewater) (MIT, © its authors; see `LICENSE`), pinned at Tidewater
commit `1438b1abfcaee3267092b75573014f4d9b4a983c`. The WebGPU/WGSL engine, CDLOD terrain, ocean, sky, clouds,
post-processing, quality tiers and headless harness are Tidewater's and bay-crossing's; the real-data terrain,
buildings and landmarks are bay-crossing's pipelines and tiles, reused unchanged.

The ride model (`src/sim/bike.js`) re-implements the behaviour of the INKFALL "Astra" build's
`app/physics.ts` (icomppower/inkfall, branch `inkfall-astra-shuimo`) with named constants.

The bikes, riders, course ribbon, kickers, gates, props, cars and particles are generated in code.

## Audio: `public/audio/`

CC0 recordings from [Freesound](https://freesound.org); every file is credited with its author and source link
in [`public/audio/CREDITS.md`](public/audio/CREDITS.md).

## Geospatial data

Every source is fetched by script into `data/raw/` (checksums in `data/raw/MANIFEST.sha256`, licences in
`data/raw/sources.json`; G0 checks both).

| Cached file | Source | Licence |
|---|---|---|
| `sf-buildings.geojson` | [San Francisco Building Footprints](https://data.sf.gov/d/ynuv-fyni) (DataSF, City and County of San Francisco): footprints with LiDAR-derived heights (`hgt_median_m`, `peak_1st_m`) | ODC PDDL 1.0 — [public domain dedication](http://opendatacommons.org/licenses/pddl/1.0/) |
| `landmarks-osm.json` | [OpenStreetMap](https://www.openstreetmap.org) landmark and waterfront features (bridge towers, Ferry Building, Coit Tower, Transamerica Pyramid, Alcatraz, Sausalito ferry terminal, Embarcadero piers), via the Overpass API | ODbL 1.0 — © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |
| `noaa-enc-landmarks.json`, `noaa-enc-pylons.json` | [NOAA ENC Direct to GIS](https://nauticalcharts.noaa.gov/data/enc-direct-to-gis.html) (Office of Coast Survey), harbour-scale charted landmarks and bridge pylons; used as the independent georeference (G3) | Public domain (US Government work) |
| `naip-sf.tif`, `naip-sausalito.tif`, `naip-bay.tif` | [USDA NAIP](https://naip-usdaonline.hub.arcgis.com/) aerial orthoimagery (USGS The National Map NAIP ImageServer), natural colour resampled to 1 m (building boxes: each roof's colour is the median of the pixels inside its footprint) and 4 m (the whole terrain square: the ground colour map) | Public domain (US Government work) |
| `terrain-3dep.tif` | [USGS 3D Elevation Program](https://www.usgs.gov/3d-elevation-program) (3DEPElevation ImageServer), resampled to the slice grid | Public domain (US Government work) |
| `noaa-datums-9414290.json` | [NOAA CO-OPS tidal datums](https://tidesandcurrents.noaa.gov/datums.html?id=9414290), San Francisco station 9414290 (sets game sea level = local MSL) | Public domain (US Government work) |
| `bathy-ncei.tif` | [NOAA NCEI](https://www.ncei.noaa.gov/products/coastal-elevation-models) coastal DEM mosaic (topobathy; DEM_mosaics/DEM_all ImageServer), resampled to the slice grid | Public domain (US Government work) |

| `route-osm.json` | [OpenStreetMap](https://www.openstreetmap.org) ways (`highway=*` including `highway=steps`, `railway=tram`) and street furniture (lamps, benches, trees) in the course box 37.7945,−122.4075 → 37.8045,−122.3920, via the Overpass API: the traced route, stair counts, widths, surfaces, the F-line crossings and the props along the line | ODbL 1.0 — © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) |

Derived tiles and the baked route in this repository are processed copies. Map data from OpenStreetMap is
available under the Open Database License; `public/route/` is a Produced Work under ODbL.

### Landmarks: `public/landmarks/`

Procedural models written by our own scripts, with no hand modelling and no third-party meshes. They are built
offline in Blender 5.2 (headless: `node tools/landmarks/build.mjs`, which runs `tools/landmarks/build.py`) into
three LOD GLBs each. Positions and footprints come from `landmarks-osm.json` (OpenStreetMap, ODbL) and the SF
building footprints (Ferry Building). Published dimensions:

- **Golden Gate Bridge:** main span 4,200 ft (1,280 m), side spans 1,125 ft (343 m), towers 746 ft (227 m) above
  the water, 220 ft (67 m) clearance, 90 ft (27.4 m) deck, 25 ft stiffening truss, suspenders every 50 ft.
  Source: Golden Gate Bridge, Highway and Transportation District, "Bridge Design & Construction Statistics"
  (goldengate.org). International Orange colour per the District. Tower centres from OSM.
- **Ferry Building:** 660 ft (201 m) shed, 245 ft (74.7 m) clock tower (Port of San Francisco).
- **Coit Tower:** 210 ft (64 m) fluted column (OSM `height`; San Francisco Recreation and Parks).
- **Transamerica Pyramid:** 853 ft (260 m), 175 ft (53 m) base, the top 212 ft spire, east and west wings
  (OSM `height`; building fact sheets).
- **Alcatraz:** OSM building footprints on the island; lighthouse 84 ft (26 m) per OSM `height`, other heights
  by building type.

## Fonts

[Inter](https://rsms.me/inter/) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL Open Font License),
loaded from Google Fonts.

## Libraries

[Vite](https://vite.dev) (MIT) is the build tool (npm dev dependency). The `webgpu` npm package (Dawn, BSD-3) runs
the headless gates. No runtime dependencies.

## Techniques and references

These are published techniques. No code from the papers is included.

| Technique | Source |
|---|---|
| FFT ocean spectra | J. Tessendorf, *Simulating Ocean Water* |
| Atmosphere | S. Hillaire, *A Scalable and Production Ready Sky and Atmosphere Rendering Technique* (2020) |
| Volumetric cloud modelling | A. Schneider (Guerrilla Games), the *Nubis* talks |
| Motion blur | M. McGuire et al., *A Reconstruction Filter for Plausible Motion Blur* (2012); J. Jimenez, *Next Generation Post Processing in Call of Duty: Advanced Warfare* (2014) |
| Bloom | J. Jimenez (2014) |
| Sharpening (RCAS) | AMD FidelityFX Super Resolution 1 |
| Rasterized caustics | Evan Wallace's *WebGL Water* approach |
| Breaking waves | Guerrilla Games, *Horizon Forbidden West* water (SIGGRAPH 2022) |

The cloud noise, lighting and sampling scheme (`src/sky/Clouds.js`) is adapted from DRG Software Solutions'
own *Sky Pro WebGPU*. It is published here under this repository's MIT license by its copyright holder.

