# Worldseed — Depth Systems (round 6 contracts)

The genre's best games stay interesting for hundreds of hours because the world is
deep. People have personalities, kingdoms have histories, eras change the rules, and
the player can tune all of it. These systems give Worldseed that depth. All names,
lists and numbers here are original to Worldseed.

Rule of thumb: **every system must be visible**. Traits show as chips and badges,
statuses as icons over heads, items on bodies, eras in architecture, and ages in the sky.
Mechanics nobody can see do not count.

## 1. World Laws (core registry, done)

`src/core/laws.js` has 14 categories and about 60 laws. Each law has an `owner`
(`core | civ | life | nature | landscape | atmosphere | effects | ui`), and the owner honours
it. Read `game.laws.<key>` at the point of use. The UI builds the panel from `LAWS` and
`LAW_CATEGORIES`.

## 2. World Ages (core system, done)

`src/core/ages.js`. `game.age` is always defined: `{id, name, title, description, color,
startedAt, duration, progress, mods}`. `game.setAge(id)` starts an age immediately and emits
`'age'` `{age, previous}`. Ages are Dawn, Bounty, Embers, Rime, Tempests, Lore, Blight,
Twilight and Iron.

Every module must make the current age **felt**:

| Modifier | Who applies it | How it shows on screen |
|---|---|---|
| `fertility` | Nature (growth, spread, crops), Life (grazing), Civ (harvest) | lush or withered fields |
| `birth` | Civ (births), Life (animal breeding) | crowded or empty towns |
| `storms`, `lightning` | Atmosphere (weather odds), Effects (lightning fires) | skies |
| `fireRisk` | Effects (ignite and spread probability) | wildfires |
| `plague` | Effects (contagion), Life (sick status) | green miasma |
| `fungi` | Nature (mushroom spread, glow) | mushroom carpets |
| `monsters` | Life (wandering monster spawns) | monsters |
| `warlike`, `harmony` | Civ (war odds, loyalty, rebellions) | wars and rebellions |
| `techRate` | Civ (research speed) | faster era changes |
| `temperature` | Landscape (snow line, frozen water), Nature (species stress), Atmosphere (snow weather) | snow and ice reaching further, or retreating |
| `night` | Atmosphere (longer, dimmer nights, moon tint) | twilight sky |
| `skyTint` | Atmosphere (sky and colour grade lean toward it) | tinted sky |

## 3. Seasons (core time, done)

`game.time.season` is a value in `[0, 4)`: the integer part indexes Spring, Summer, Autumn
and Winter (`game.time.seasonName`), and the fraction is progress through that season. Each
season lasts one day-night cycle. When the `weatherSeasons` law is off, the value is fixed at
mid-summer (1.5). Effects by owner:
- **Nature:** blossom on fruit trees and wildflowers in spring, a rich summer green, autumn
  oranges, reds and golds on deciduous trees with falling leaves, and bare deciduous trees
  plus snow on canopies in winter. Conifers stay green. Crops are sown in spring and harvested
  in late summer and autumn.
- **Landscape:** grass hue shifts through the year (fresh green, deep green, gold-brown,
  frost-dulled). Winter snow covers the colder latitudes and higher ground, scaled by the
  `biomeFrost` law and the age's `temperature`. Lakes freeze at the coldest latitudes.
- **Atmosphere:** more snowfall in winter, showers in spring and storms in summer, plus a
  slight sun-angle and light-colour change.
- **Civ and Life:** there is less food in winter (granaries matter), and animals breed in
  spring.

## 4. Creatures: traits, statuses, equipment, experience, biography (Life owns)

Data lives on each unit. The registries go in `src/sim/units/` (Life). Civ, Effects and UI
consume them through the API below.

### Traits
`TRAITS` in `src/sim/units/traits.js` holds about 36 original traits, each
`{id, name, category, description, icon, rarity, mods, opposite?}`. The categories are:
- **body:** Mighty, Frail, Swift, Lumbering, Towering, Small, Hardy, Sickly
- **mind:** Sage, Dim, Curious, Stubborn, Inventive
- **spirit:** Valiant, Craven, Gentle, Cruel, Greedy, Generous, Devout, Restless
- **gift:** Lucky, Starborn (rare, glows faintly), Fireheart, Frostborn, Green-thumbed, Silver-tongued
- **scar** (earned through events): Veteran, Scarred, Survivor, Kinslayer, Plague-touched, Hero

`mods` may contain `hp`, `damage`, `speed`, `lifespan`, `work` (job speed), `fertility`,
`diplomacy` (for rulers), `fear`, `aggression` and `research`, as multipliers or offsets.
`opposite` traits never coexist on one unit.
- `unit.traits` is an array of ids.
- API: `game.units.addTrait(u, id)`, `removeTrait(u, id)`, `hasTrait(u, id)`,
  `traitMod(u, key)` (combined multiplier).
- Births inherit traits (law `lifeInheritance`) with a small chance of mutation.
- Events grant scar traits (law `lifeTraits`). Kings' traits drive Civ decisions: Cruel and
  Valiant kings start wars, Gentle and Silver-tongued kings make peace, Sage and Inventive
  kings boost research.

### Statuses (temporary)
`STATUSES` in `src/sim/units/statuses.js`: Burning, Sick, Blessed, Inspired, Enraged,
Chilled, Starving, Exhausted, Wounded, Mourning, Frightened, Sleeping. Each is
`{id, name, icon, description, mods, defaultDuration}`.
- `unit.statuses` is a `Map` from id to remaining seconds.
- API: `addStatus(u, id, seconds?)`, `removeStatus(u, id)`, `hasStatus(u, id)`.
- The renderer shows a small icon above the unit when it is close or selected.
- Effects applies Burning and Sick. Atmosphere and Landscape conditions apply Chilled (the
  Rime age, snow tiles). Civ applies Inspired (golden age) and Mourning (a ruler's death).

### Equipment and inventory
`src/sim/units/items.js` defines:
- **Slots:** `weapon`, `armor`, `tool`, `trinket`.
- **Materials:** wood, stone, bronze, iron, steel, and starsteel (rare, legendary).
- **Quality:** crude, common, fine, masterwork, legendary.

An item is `{id, slot, kind, material, quality, name, power, history?}`. Legendary items get
generated names and a history, for example "Dawnbrand, forged in Elderley, Year 212".
- `unit.equipment = {weapon, armor, tool, trinket}`, each an item or null.
- API: `equip(u, item)`, `makeItem(spec)`, `itemPower(u)`.
- Equipment changes stats and **shows on the model**: weapon shape and material colour,
  armour tint, a glow for legendary items.
- Civ blacksmiths forge items from the kingdom's resources, limited by kingdom technology
  (law `lifeEquipment`).
- When a unit dies, its items drop to its village or kingdom inventory, or lie on the
  ground for a while.

### Experience and fame
- `unit.xp` and `unit.level` (1–10), raised through `addXP(u, n)` for kills, work done and
  survived disasters (law `lifeExperience`).
- Level 7 and above earns a title, such as "the Bold".
- Very high levels earn the Hero trait.
- `unit.data.favorite` is a player star (UI).

### Biography
- `unit.bio` is an array of `{t (game s), text}`, capped at 24 entries, written with
  `game.units.log(u, text)`.
- Life logs birth, parents, traits gained, levels and death.
- Civ logs jobs, marriage, coronation, wars and conquests.
- The inspector shows it as a timeline.

## 5. Civilization: eras, technology, culture, kingdom inventory (Civ owns)

### Eras and technology
`src/sim/civ/tech.js`. There are four eras: **Hearth**, **Bronze**, **Iron** and **Enlightened**.
About 20 technologies, each `{id, name, era, cost, requires: [], description, effects}`, for
example:
- Hearth era: Agriculture, Masonry, Pottery, Fishing
- Bronze era: Bronzeworking, Sailing, Writing, Irrigation, Horsemanship
- Iron era: Ironworking, Fortification, Medicine, Mathematics, Architecture
- Enlightened era: Steelworking, Philosophy, Banking, Engineering, Astronomy

Each kingdom has:
- `k.knowledge`, the research points it is accumulating. These come from population,
  scholars, temples, libraries and wise kings, scaled by `civTechSpeed` and the age's
  `techRate`. Research only happens while the `civTechnology` law is on.
- `k.techs`, a `Set` of the technologies it has learned.
- `k.era`, an index from 0 to 3.
- `k.researching`, the technology currently in progress.

API: `game.civ.hasTech(kingdomId, techId)`, `game.civ.kingdomEra(kingdomId)`.

**Eras must show in the world.** Building tiers change materials as a kingdom advances:
- Hearth: thatch and timber.
- Bronze: stone footings and tile.
- Iron: stone, slate and towers.
- Enlightened: refined stone, banners and glass.

The eras also unlock new building types (library, harbour with ships, observatory, aqueduct)
and change soldiers' gear through Life's item materials. Every learned technology and every
era change goes to the chronicle.

### Culture
- `game.civ.cultures` holds the living cultures. Each is `{id, name, traits: [], color, language}`,
  derived from the four peoples.
- Culture traits: Seafaring, Martial, Scholarly, Pastoral, Mystic, Mercantile, Masons and
  Wanderers, with two or three per culture. They shape priorities: what a culture builds,
  which jobs it favours, how warlike it is and what it researches.
- Cultures spread with migration and conquest, and drift slowly over time. A distant colony
  may become a new culture with a new name.
- `kingdom.culture` holds the ruling culture, and `village.cultureMix` records the mix of
  cultures living in a village.

### Kingdom inventory
`k.inventory` holds `{food, wood, stone, ore, gold, tools, weapons, armor}`, aggregated from the
kingdom's villages. Item stock comes from the smiths, and the UI shows it in the kingdoms
panel and the village inspector.

## 6. UI (owns presentation)

- **World Laws panel:** one tab or section per category (14), with descriptions and search,
  built from the registry.
- **Ages:**
  - A top-bar chip shows the current age: its colour, title and a progress ring.
  - An Ages panel lists every age with its effects, and a "Call forth" button runs
    `game.setAge`.
  - A short banner animates when an age changes.
- **Inspector (creature):**
  - Header: portrait, name, title and level.
  - Trait chips with tooltips, and status icons.
  - Equipment slots with item cards; legendary items get a gold frame and their history.
  - Biography timeline and a favourite star.
- **Inspector (village and kingdom):**
  - Era badge and tech progress.
  - Culture with its traits.
  - Inventory and ruler traits.
- **Kingdom tech panel:** the tech tree, showing what is learned and the progress on current
  research.
- **Minimap:** off by default, with a toggle in Settings. It is replaced by an "Overview"
  button (and the key M) that eases the camera out to frame the whole map; pressing it again
  returns to the previous view.
- Everything must work on phones and tablets.
