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
| Great East Asia | `great-east-asia` | regional, Vast-class | East and Southeast Asia |
| Asia Mainland | `asia-mainland` | regional, Vast-class | continental Asia |
| Japan | `japan` | regional, Vast-class | the Japanese archipelago (south coast of Korea at the edge) |
| Taiwan | `taiwan` | regional, Vast-class | Taiwan, Penghu, Green Island and Orchid Island |
| Europe | `europe` | regional, Vast-class | Iceland to the Urals, Scandinavia to the North African coast |
| North America | `north-america` | regional, Vast-class | Alaska and Canada to Panama and the Caribbean |

- "Vast-class": about the same tile count as Vast (1024 × 512 ≈ 524k tiles). Each regional map picks its own width and height so that, at the window's middle latitude, one tile spans about the same distance east–west as north–south (so Europe and Japan keep their real shapes). A tall region such as Taiwan gets a portrait map. Dimensions must suit the terrain chunking.
- Vast and the regional maps keep Vast's "desktop only" rule on touch devices. Touch devices default to the largest whole-Earth size they allow.
- URL: `?preset=earth&size=1024` for whole-Earth sizes; `?preset=earth&region=<id>` for a regional map (size is then implied). New World and the title screen write these and reload as they do today. Loading labels say e.g. "Shaping Japan".

## 2. Geography (owner: Geography — `src/world/earth.js`, `src/world/geo.js`, `src/world/data/*`, `tools/*`)

- `world.meta.geo = { region, lonMin, lonMax, latMin, latMax, wrap }` on every World Map world (`region: 'world'` for the whole Earth, `wrap: true` only there). `src/world/geo.js` exports `geoInfo(world)`, `geoRegion(world)`, `geoLonLat(world, x, z) → [lon, lat]` and `geoTile(world, lon, lat) → {x, z} | null` (null outside the window). Other modules use only these.
- Regional coastlines come from Natural Earth 1:10m land (public domain; npm package `@geo-maps/earth-lands-10m`), rasterised by a build tool into compact per-region masks under `src/world/data/`, like `earthMask.js`. The game never ships the raw GeoJSON.
- Relief and climate reuse the World Map pipeline (`earthFeatures.js` is authored in longitude and latitude), scaled for the regional zoom so that ranges read as mountains, not cliffs or bumps, with extra regional detail where the whole-Earth data is too coarse (for example Taiwan's Central Mountain Range and western plain; the Japanese Alps; the Alps, Pyrenees, Carpathians and Scandinavian mountains; the Rockies, Sierra Nevada, Appalachians and Sierra Madre; the Himalaya, a rolling Tibetan plateau, Tian Shan and Altai).
- Lakes and rivers at regional scale: the major ones only, carved as today.
- The camera, minimap and Overview fit any aspect, including portrait maps; the World Map is never rotated.

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
- Naming: a village founded later takes the nearest real name not held by a living village: its own realm's cities within about 4.5 degrees (6 to 20 tiles), else any listed place within about 2.5 degrees (4 to 10 tiles), else a generated name. Settlers of an independent colony still look among their parent realm's cities. Conquered villages keep their names; a razed city's name can be taken again.
- Real realms carry `plain: true` (notes and labels say "Japan", never "the Japan") and `realm` (their index in the region's list). A real realm cannot be absorbed in a union during its first 30 years.
