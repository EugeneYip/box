# Tangible technology — contract (round 10)

Every technology must unlock something the player can **see in the world and
that changes what happens**, not only a hidden multiplier. Multipliers stay,
but each tech also adds a building, a vehicle, a unit type or a behaviour,
announced in the chronicle the first time a realm uses it ("The Kingdom of X
launches its first trading cog"). The tech panel and tech tooltips list each
unlock in plain words.

New techs are added where the tree had gaps (marked **new**). Ids are stable.

## Hearth era

| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| Agriculture | Ploughed field rows, a farmstead barn | Farms (existing) | Civ |
| Masonry | Stone footings, stone houses replace timber, paved village square | Sturdier buildings (fire resistance) | Civ |
| Pottery | Kiln and granary with jars | Food cap (existing) | Civ |
| Fishing | **Fishing boats**: small rowing/sail boats leave a jetty, fish offshore over shoals, return with catch | Food from water tiles near the coast and on lakes and rivers | Fleets |
| **The Wheel** (new, requires Agriculture) | **Ox carts** haul wood, stone, food and ore between villages and the capital along roads | Pools resources inside a realm; carts can be raided in war | Fleets (vehicles; Civ decides when) |

## Bronze era

| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| Bronzeworking | Forge with glowing hearth, bronze gear (existing) | | Civ |
| Sailing | Harbour (existing) with **trading cogs** and **transport ships** | Trade cogs sail between friendly harbours carrying goods (gold and resources move; routes drawn faintly at mid zoom). Transport ships carry **settlers** to found villages on other islands and continents, and carry **armies** across water in war | Fleets (+ Civ decisions) |
| Writing | Library (existing), scribes walk with scrolls | Research | Civ |
| Irrigation | Visible irrigation channels and a water wheel or shaduf beside fields | Fields near water yield more; farms can spread into drier land | Civ |
| Horsemanship | Stables, **mounted riders**: messengers on roads and **cavalry** soldiers | Cavalry are fast flankers; messengers speed diplomacy | Life (riders) + Civ (stables, roles) |

## Iron era

| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| Ironworking | Iron gear (existing), bloomery with smoke | | Civ |
| Fortification | Walls (existing), gatehouses and watchtowers that **shoot at raiders** | | Civ |
| Medicine | Healer's house with herb garden; **healers** walk to the sick and wounded | Healers cure Sick and Wounded nearby, lower plague deaths | Civ + Life |
| Mathematics | Surveyors' stakes, straight roads | Roads link villages (carts and armies move faster on them) | Civ |
| Architecture | Aqueduct (existing), **stone bridges** over rivers | Bridges let carts and armies cross rivers | Civ |
| **Shipbuilding** (new, requires Sailing and Ironworking) | Shipyard slipway with a hull being built; **war galleys** | Naval battles, blockades of enemy harbours, escorting transports | Fleets |
| **Siegecraft** (new, requires Fortification and Mathematics) | **Battering rams** and **catapults** roll with armies; catapult stones arc and break walls | Sieges breach walls faster | Fleets (vehicles; Civ decides when) |

## Enlightened era

| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| Steelworking | Steel gear (existing), foundry | | Civ |
| Philosophy | Forum or temple with gathered citizens | Loyalty (existing) | Civ |
| Banking | Market hall with stalls and a counting house; **trade caravans** of pack animals between realms at peace | Gold and diplomacy improve with trade partners | Fleets (vehicles; Civ decides when) |
| Engineering | Windmills and watermills turning, cranes on construction sites | Build speed (existing) | Civ |
| Astronomy | Observatory (existing) | Ships sail at night and further; **exploration ships** chart the world and carry colonists to distant continents (important on the World Map) | Fleets |
| **Navigation** (new, requires Astronomy and Shipbuilding) | Great **carracks** (larger trade and transport ships, ocean-going) | Long ocean trade routes and overseas colonies | Fleets |

## Fleets module (new: `src/sim/fleet/`, `src/render/fleet/`) — all vehicles, on water and on land

- `game.fleet` with `tick(step)`, `update(dt)`, `reset`, `inspect`, `stats`.
- Vessel kinds: `fishing`, `cog` (trade), `transport`, `galley` (war), `explorer`, `carrack`.
  Each has a model, sail and wake, speed, capacity, health and owner kingdom.
- Water navigation: a coarse water-tile graph (sea, lakes and navigable rivers),
  computed once per world and updated on terrain edits. Vessels never cross land.
  Must work on rectangular worlds (2:1 World Map).
- Civ asks Fleets for voyages: `fleet.requestVoyage({ kind, kingdom, from: harbourId, to: harbourId | {x,z}, cargo })`.
  Fleets reports arrival or loss through events (`'fleet:arrived'`, `'fleet:lost'`), and Civ applies the cargo
  (goods, settlers founding a village, an army landing). `civ.harbours(kingdomId)` lists harbour sites.
- War: galleys of realms at war seek and fight each other and attack transports;
  a sunk vessel leaves floating debris. Storms, tornadoes and sea monsters can sink ships.
- Powers work on ships (smite, meteor and so on). The inspector shows a vessel: owner, kind, cargo, crew, voyage.
- Budgets: a capped number of vessels per realm and per world size, LOD with dots at far zoom,
  and cheaper updates in power saver.
- World Laws (add to `laws.js`, owner `fleet`): `fleetSailing` (bool), `fleetNaval` (bool, naval war),
  `fleetColonize` (bool, overseas settlement).

## Acceptance

Over a 600-year run on a square Medium map and on the World Map:
- Every tech's unlock appears in the world and the chronicle.
- Fishing boats work every coast.
- Trade cogs run routes between friends.
- Transports found at least one overseas colony on the World Map.
- Galleys fight in sea wars.
- Carts, caravans, siege engines, cavalry and healers are visible.
- Performance stays within the existing budgets.
