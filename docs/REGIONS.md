# World Map sizes, regional maps and real places — contract (round 13)

The World Map section of New World (title screen and the New World panel)
offers the whole Earth at three sizes plus six regional maps. Preloaded
realms and villages on every World Map world carry **real country and city
names**. Flags stay original: realms get the game's own banners and colours,
never real flags.

## 1. Choices under "World Map" (owner: Geography)

| Entry (shown as the size name) | id | Map | Notes |
|---|---|---|---|
| Large | `large` | whole Earth 512 × 256 | kept, not the default |
| Huge | `huge` | whole Earth 768 × 384 | kept, not the default |
| **Vast** | `vast` | whole Earth 1024 × 512 | **default on desktop** |
| Great East Asia | `great-east-asia` | 768 × 704, 73–150°E, 11.3°S–54.3°N, ~10 km tiles | East and Southeast Asia |
| Asia Mainland | `asia-mainland` | 896 × 576, 44.3–145.7°E, 5–60°N, ~11 km tiles | continental Asia |
| Japan | `japan` | 704 × 768, 128–146.5°E, 29.9–45.9°N, ~2.3 km tiles | the Japanese archipelago (south coast of Korea at the edge) |
| Taiwan | `taiwan` | 640 × 832 (portrait), 119–122.4°E, 21.6–25.7°N, ~0.5 km tiles | Taiwan, Penghu, Green Island and Orchid Island (a corner of the Fujian coast at the top left) |
| Europe | `europe` | 832 × 640, 26.5°W–63.5°E, 32.2–73.8°N, ~7 km tiles | Iceland to the Urals, Scandinavia to the North African coast |
| North America | `north-america` | 832 × 640, 170–50°W, 6.2–75.8°N, ~12 km tiles | Alaska and Canada to Panama and the Caribbean |

The windows and sizes live in `src/world/data/regions.js` (shared by the game and the mask tool).

- "Vast-class": about the same tile count as Vast (1024 × 512 ≈ 524k tiles). Each regional map picks its own width and height so that, at the window's middle latitude, one tile spans about the same distance east–west as north–south (so Europe and Japan keep their real shapes). A tall region such as Taiwan gets a portrait map. Dimensions must suit the terrain chunking.
- Vast and the regional maps keep Vast's "desktop only" rule on touch devices. Touch devices keep Large as their default (a regional URL on a touch device falls back to it).
- URL: `?preset=earth&size=1024` for whole-Earth sizes; `?preset=earth&region=<id>` for a regional map (size is then implied: `params.size` is 1024 and `params.region` the id). New World and the title screen write these and reload as they do today; a change of region always reloads, even between maps of the same dimensions (Europe and North America). Loading labels say e.g. "Shaping Japan"; the top bar reads "Japan · Seed 7".
- The title screen shows the three whole-Earth sizes on one row and the six regions under "Regional maps"; New World does the same with cards drawn in each map's shape, and a note giving the region's tiles and tile size. On World Map worlds the "Starting villages" control reads "Auto (real places)" and shows the cap `src/sim/civ/realms.js` seeds with (26 on Vast and the regional maps).

## 2. Geography (owner: Geography — `src/world/earth.js`, `src/world/geo.js`, `src/world/data/*`, `tools/*`)

- `world.meta.geo = { region, lonMin, lonMax, latMin, latMax, wrap }` on every World Map world (`region: 'world'` for the whole Earth, `wrap: true` only there); `world.meta.region` repeats the id and `world.meta.kmPerTile` gives the tile size. `src/world/geo.js` exports `geoInfo(world)`, `geoRegion(world)`, `geoLonLat(world, x, z) → [lon, lat]`, `geoTile(world, lon, lat) → {x, z} | null` (null outside the window) and `geoKmPerTile(world, x?, z?)`. Other modules use only these.
- Land that runs off a regional window runs to the window's edge (the terrain skirt carries it on beyond the border); only real seas meet the edge as water, and the sea deepens toward the border so no shelf ends in a straight line. (The whole Earth keeps its deep-sea ring.)
- `world.meta.budgetArea` on regional maps is habitable land / 0.3, capped at 440k (the Vast whole Earth is about 345k), so a map of mostly land does not run several times Vast's population.
- Regional coastlines come from Natural Earth 1:10m (public domain): the union of the 1:10m admin-0 countries (npm `which-country-ne-10m`), with the larger 1:50m lakes (npm `sane-topojson`), rasterised at twice the tile resolution by `tools/region-masks.mjs` into `src/world/data/mask-<id>.js` (11–39 KB each). (`@geo-maps/earth-lands-10m` turned out to be OpenStreetMap data under the ODbL, so it was not used.) The game never ships the source data.
- Relief and climate reuse the World Map pipeline (`earthFeatures.js` is authored in longitude and latitude), scaled for the regional zoom so that ranges read as mountains, not cliffs or bumps (heights grow as tiles get finer: x1.2 on Europe, x1.65 on Japan, x1.9 on Taiwan; the great ranges have broad bodies of peaks, parallel ridges and valleys under their high sub-ranges), with extra regional detail where the whole-Earth data is too coarse (for example Taiwan's Central Mountain Range and western plain; the Japanese Alps; the Alps, Pyrenees, Carpathians and Scandinavian mountains; the Rockies, Sierra Nevada, Appalachians and Sierra Madre; the Himalaya, a rolling Tibetan plateau, Tian Shan and Altai).
- Lakes and rivers at regional scale: the major ones only (lakes from the mask plus a few the 1:50m data lacks, such as Biwa; rivers from earthFeatures.js plus regional ones in `src/world/data/regionFeatures.js`, which also holds the regional relief detail). The water surface is one sheet at sea level, so on every World Map world a lake holds water only in low country (a large upland lake such as Victoria sits in a broad shallow bowl); lakes on high ground (Tibet, the Altiplano, Issyk-Kul) are flat marshes, and no water is left at the bottom of a pit. River channels widen downstream and with finer tiles; regional rivers emerge where the ground falls below about 1.2 km, except the Hengduan rivers (Irrawaddy, Salween, Mekong, Yangtze) and the Brahmaputra's Great Bend, which cut parallel gorges from the plateau's edge.
- Snow and tree lines come from real elevation (each relief layer's units per km), latitude, distance from the ocean and moisture: no trees above the tree line (alpine grass, rock toward the snow), snow-capped Alps, Rockies, Caucasus, Himalaya and Fuji, rock and alpine grass on Taiwan's highest crests.
- The camera, minimap and Overview fit any aspect, including portrait maps; the World Map is never rotated (a portrait minimap keeps the panel's height rather than growing taller).
- Islands that carry realms stay land at regional sizes: on the Taiwan map Penghu (Magong), Green Island and Orchid Island are land, and Hualien and Penghu seat their realms; well-known cities checked on every regional map land on land or within one tile of it (Mumbai lies just west of Great East Asia's window).
- On the whole Earth: the Himalaya, Karakoram and Kunlun are `peaks` ranges (separate summits over deep saddles, and their capped front is scored by spurs); the Tibetan plateau rolls with its own ranges and has no terraced benches; narrow islands keep green shores; and the sea and its cold tint fade gradually toward the border so the map's top and bottom show no box edge.

## 3. Real realms and villages (owner: Civ — `src/sim/civ/*`, data in `src/sim/civ/places/*`)

- One data module per region id (`world`, `great-east-asia`, `asia-mainland`, `japan`, `taiwan`, `europe`, `north-america`): a list of realms `{ name, capital: { name, lon, lat }, cities: [{ name, lon, lat }], color?, culture? }`, using common English names and spellings (Taiwan place names in the forms used in Taiwan: Taipei, Keelung, Hsinchu, Taichung, Kaohsiung, …).
- **China is split** on the world, Great East Asia and Asia Mainland maps: **"Mainland Region"** holds the north (roughly north of the Qinling–Huai line, with its capital at Beijing) and **"ROC"** holds the south together with Taiwan (capital Nanjing; Taipei, Shanghai, Guangzhou and others are among its cities). Both are editable in game like any realm.
- **Japan map:** realms are Japan's traditional regions (Hokkaido, Tohoku, Kanto, Chubu, Kansai, Chugoku, Shikoku, Kyushu), plus the Korean realm whose coast lies inside the window. **Taiwan map:** realms are major cities and counties (for example Taipei, Taoyuan, Hsinchu, Taichung, Changhua, Chiayi, Tainan, Kaohsiung, Pingtung, Yilan, Hualien, Taitung, Penghu), each with real towns as villages.
- **Seeding:** on a World Map world, Civ places these realms instead of the random starts. Each capital becomes a village on the nearest suitable land tile within a small radius of its real position (via `geoTile`). A realm whose capital cannot be placed (outside the window, or no land nearby at this size) is skipped. Each realm gets a few of its largest cities as extra starting villages, within the village budget, leaving room for growth.
- **Growth keeps real names:** a new village founded inside a preloaded realm takes the nearest unused real city name of that realm (within a sensible distance), falling back to generated names.
- Realm names are shown as given (e.g. "Japan", "Mainland Region", "ROC", "Kanto"), without "Kingdom of". Colours stay distinct from neighbours; banners use the game's own emblems.
- Square presets keep their generated names and random starts.

### Implementation notes (Civ, `src/sim/civ/realms.js`)

- Realms are listed most important first; `country(id, opts)` in `places/countries.js` builds a region's copy of a shared country (`first` reorders its cities for that map, `edge: true` seats a realm whose capital lies outside the window at its first city inside it, e.g. Russia at Vladivostok on Great East Asia or Korea at Busan on Japan). `color` is matched to the nearest heraldic tincture unless a neighbour wears one too close; `culture` overrides the culture read from the land.
- Counts: up to 20 realms and 26 starting villages on Vast and the regional maps (never more than three quarters of the village budget), scaled by the square root of the tile count on smaller maps (Large: 10 realms, 13 villages; Huge: 15 and 20). An explicit `?civs=` caps both. Extra cities go to the bigger realms first (the first two realms share alike).
- Spacing at the start: 9 tiles within a realm, 10 between realms on one landmass, 7 across water. A city whose real position already has a neighbour that close is skipped rather than pushed elsewhere. A capital may move up to 6 tiles on the whole Earth (more on the regional maps, up to 16) to find ground; on rugged or narrow land (Taiwan or Japan on the whole Earth) a small pad is levelled.
- Naming: a village founded later takes the nearest real name not held by a living village: its own realm's cities within about 4.5 degrees (9 to 20 tiles), else any listed place within about 3.5 degrees (7 to 16 tiles), else a generated name. Settlers of an independent colony still look among their parent realm's cities. Conquered villages keep their names; a razed city's name can be taken again.
- Real realms carry `plain: true` (notes and labels say "Japan", never "the Japan") and `realm` (their index in the region's list). A real realm cannot be absorbed in a union during its first 30 years.
