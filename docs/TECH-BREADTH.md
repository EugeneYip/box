# Technology breadth, urban renewal and heritage — contract (round 14)

User request: technology should cover more than war, ships and power: **food,
medicine, the land's biomes, city development and urban planning**, so a
realm gains real skills against the dangers of the world. Old structures
(walls, small old houses that hold few people) should be **rebuilt as towns,
realms and eras develop**, so new infrastructure fits on limited land, while
some are **preserved as heritage**. New technologies also bring **new units
and new god powers** that match them.

Every new technology follows `docs/TECH-UNLOCKS.md`: it unlocks something the
player can **see**, it **changes what happens**, and the chronicle announces
its first use. Models are original low-poly designs at the scale of
`docs/WORLD-SCALE.md`. Ids are stable once merged.

## 1. Five new branches

Each branch runs through the eras. Eras 0–3 must keep their round-13 pacing
(Bronze, Iron and Enlightened arrive when they do today); the new early techs
are cheap side arts, and the modern ones fit the schedule of
`docs/MODERN-ERAS.md`. The tech panel shows them in the era columns like any
other art.

### Food (danger: famine, hard winters, sieges)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 1 Bronze | Animal Husbandry (`husbandry`) | Pens and pastures with sheep, goats and cattle beside farms | Food from herds; less famine in poor soil |
| 2 Iron | Crop Rotation (`rotation`) | Fields in alternating crops and fallow strips | Steadier harvests; famine strikes less often |
| 3 Enlightened | Preservation (`preservation`) | Smokehouses and salting sheds; barrels in granaries | Food keeps longer: winters and sieges starve fewer |
| 4 Industrial | Canning & Fertilizer (`canning`) | Cannery; fertilizer carts in the fields | Bigger harvests; food sent to starving towns of the realm |
| 5 Modern | Mechanized Farming (`tractors`) | **Tractors** in the fields, silos | Fewer farmers feed more people |
| 6 Atomic | Green Revolution (`hybridcrops`) | Greenhouses, irrigated circles | Farms thrive in dry land |
| 7 Future | Vertical Farms (`vertfarms`) | **Vertical farm towers** | Food independent of season and biome |

### Medicine (danger: plague, wounds, old age)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 2 Iron | Medicine (`medicine`, exists) | Healer's house, healers | (unchanged) |
| 3 Enlightened | Quarantine (`quarantine`) | Plague flags on sick houses; a lazaretto outside town | Plague spreads far less between towns |
| 4 Industrial | Vaccination (`vaccination`) | Clinics; doctors visit houses | Fewer plague cases; children survive |
| 5 Modern | Antibiotics & Hospitals (`antibiotics`) | **Hospitals** with **ambulances** | Wounded and sick recover; plague deaths fall sharply |
| 6 Atomic | Genetics (`genetics`) | Research hospital with a helix sign | Longer lives; fewer inherited ailments (traits) |
| 7 Future | Nanomedicine (`nanomed`) | Medical drones over towns | Very long lives; plague nearly harmless |

### Biomes and environment (danger: harsh land, deforestation, drought, floods)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 1 Bronze | Terracing (`terracing`) | Terraced hillside fields | Farms on slopes and in mountains |
| 2 Iron | Wells & Qanats (`qanats`) | Wells and underground channels in dry land | Towns and farms in deserts and steppe |
| 2 Iron | Cold Building (`coldbuild`) | Thick-walled houses with steep roofs and stoves | Towns in tundra and snow; winters kill fewer |
| 3 Enlightened | Forestry (`forestry`) | Foresters replant; tree nurseries | Woods regrow near towns (no bare deforestation) |
| 4 Industrial | Drainage & Levees (`levees`) | **Levees** along rivers, polders, pumping mills | Floods and tsunamis do far less harm; marsh becomes farmland |
| 5 Modern | Weather Forecasting (`forecasting`) | **Weather stations** and radar domes | Warning before storms, tornadoes and tsunamis: people take shelter, ships make port, aircraft stay down |
| 6 Atomic | Desalination (`desalination`) | Desalination plants on dry coasts | Coastal deserts bloom; drought cannot starve a town |
| 7 Future | Terraforming (`terraforming`) | Climate towers; land greens around cities | Desert and tundra near cities slowly turn to grassland |

### City development (danger: fire, earthquakes, overcrowding)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 3 Enlightened | Fire Brigades (`firebrigade`) | Fire station; **bucket brigades** run to fires | Fires in towns are put out quickly |
| 4 Industrial | Building Codes (`buildcodes`) | Fire walls between houses, hydrants | Fires spread less; buildings last longer |
| 5 Modern | Fire Engines (`fireengines`) | **Fire engines** race to fires with sirens | Fires stopped within moments |
| 6 Atomic | Seismic Engineering (`seismic`) | Braced towers, base isolators | Earthquakes topple few buildings |
| 7 Future | Smart Cities (`smartcity`) | Glowing control spires; traffic flows | Disasters answered at once; growth boost |

### Urban planning (danger: lack of land; drives renewal)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 2 Iron | Town Planning (`townplan`) | Grid streets in new quarters | Tidier, denser new quarters |
| 4 Industrial | Zoning (`zoning`) | Distinct districts: homes, industry, markets | Factories and haze kept away from homes; **urban renewal begins** (section 2) |
| 5 Modern | Public Transit (`transit`) | **Trams and buses** on town streets | Bigger towns stay connected; growth boost |
| 5 Modern | Heritage Conservation (`heritage`) | Heritage plaques; restored old buildings lit at night | Chosen old buildings are protected (section 2); loyalty and culture boost |
| 6 Atomic | Urban Renewal (`renewal`) | Old blocks replaced by apartment towers; ring roads where walls stood | Renewal runs at full pace |
| 7 Future | Garden Cities (`gardencity`) | Parks and green roofs; elevated walkways | Very large city caps without crowding |

### Defense against the sky (danger: meteors)

| Era | Tech (id) | Visible unlock | Behaviour |
|---|---|---|---|
| 7 Future | Planetary Defense (`skyshield`) | A tracking station whose beams break up incoming meteors | Meteors and meteor showers aimed at a protected town are broken into harmless fragments in the sky (god power still works elsewhere, and the law can switch it off) |

## 2. Urban renewal and heritage

- **Renewal.** From Zoning on, as a town grows and its realm advances, buildings that hold few people for the land they take (huts, cottages, timber houses of earlier eras, small workshops) are gradually **replaced** by denser buildings of the realm's era (row houses, apartment blocks, towers) on the same ground. One building at a time per town, with demolition dust, a cleared plot and then construction, never a whole town at once. Renewal favors the most crowded towns and plots near the center.
- **Walls.** When a town grows past its walls, or a realm reaches the Industrial era and its walls no longer matter in war, wall sections are **dismantled** and a **ring road** takes their line. Gatehouses may stay as heritage.
- **Heritage.** Some old buildings are **preserved** and never replaced: the oldest hall or temple, wonders, a gatehouse, and a few of the oldest houses in a historic core. With Heritage Conservation more are chosen and restored. A heritage building keeps its original era's look, carries a small plaque, is lit at night in modern eras, and the inspector shows "Heritage: built Year N". Data: `b.heritage = { since: year }`.
- **Player control.** World Law `civRenewal` (civilization group): Off / Slow / Normal (default Normal). The inspector of a building lets the player mark or unmark it as heritage (the editor), and a heritage building is never replaced.
- Renewal follows the land limits: it is how big modern towns fit on small islands and in tight valleys, so town caps can grow without a wider footprint.

## 3. New units

Civ decides when they appear; Life draws people, Fleets draws vehicles.

- People: bucket brigades and firefighters, doctors and paramedics, foresters, farmers driving tractors, police in modern towns, scientists at campuses, astronauts boarding rockets.
- Vehicles: fire engines, ambulances, tractors, trams and buses, rescue helicopters (Modern+, fly to disasters), and the advanced boats of section 4.

## 4. Advanced boats (owner: Fleets)

In addition to the sea kinds of `docs/MODERN-ERAS.md`: **tankers** (Atomic, oil and later clean-fuel trade), **cruise liners** (Atomic, between realms at peace, lit at night), **icebreakers** (Modern, open cold-water routes), **submarines** (Atomic, patrol in war; conventional only, no strategic weapons), **patrol boats / destroyers** (Modern, escort and hunt pirates), **hovercraft** (Atomic, cross shallows and beaches), **hydrofoil ferries** (Atomic, fast passenger links), **research vessels** (Atomic, survey and boost research), and in the Future **solar trimarans** and **autonomous cargo ships**. Each with its own model, behavior, LOD and budget.

## 5. New god powers

In a new "Technology" power group (and the existing groups where they fit):

- **Gift of Knowledge**: a realm learns its current research at once.
- **Blackout**: a powered town loses power for a while (lights out, factories idle, aircraft grounded there).
- **Spawn vehicle**: drop a vehicle of a chosen kind for the nearest realm (from cog to starship), as the spawn powers do for creatures.
- **Launch**: order a realm with a launch pad to launch a rocket now.
- **Solar Storm**: auroras across the sky; satellites tumble and aircraft are grounded for a while.

No power creates weapons of mass destruction.

## Acceptance

- Every new technology appears in a 600-year Medium run (or with research speed raised), visibly, with a chronicle line.
- Each danger has a measurable counter: famine deaths, plague deaths, fire losses, flood and tsunami losses, earthquake losses and meteor losses fall in realms with the matching techs compared with realms without (measure with god powers on a test world).
- In a 500-year Medium run, some towns show renewal (old houses replaced, a ring road where walls stood) and keep heritage buildings in their cores.
- Era pacing of `docs/MODERN-ERAS.md` still holds; tick and draw-call budgets of `docs/WORLD-SCALE.md` still hold.
