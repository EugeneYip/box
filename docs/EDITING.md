# Editing nations, villages and creatures — contract (round 9)

Players can rename and customise kingdoms, villages and individual creatures
from the inspector, in the spirit of the genre's unit and kingdom editors but
with our own design. Every edit is applied through the owning module's API so
the simulation, renderers, labels, chronicle and save state stay consistent.
All functions return `true` on success, `false` when the target or value is
invalid. Every successful edit emits `game.events.emit('edit', { kind, id, key, value })`
(`kind` is `'kingdom' | 'village' | 'unit'`), so renderers and the UI refresh.
Edits made by the player are marked so the simulation does not overwrite them
(for example, a renamed village keeps its name when it changes hands, and a
recoloured kingdom keeps its colour).

## Kingdoms (Civ: `src/sim/civ`)

| API | Effect |
|---|---|
| `civ.renameKingdom(id, name)` | 1–32 printable characters, trimmed. Labels, banners, inspector and chronicle use the new name from then on. Chronicle line: "The Kingdom of A shall now be known as B." |
| `civ.setKingdomColor(id, hex)` | Any `0xRRGGBB`. Territory overlay, borders, label underline, tabards/mantles and banner refresh within a frame. `civ.kingdomColorSuggestions(id)` returns 12 swatches that keep a good hue distance from neighbours. |
| `civ.setKingdomBanner(id, { symbol, field })` | `symbol` from `civ.BANNER_SYMBOLS` (original set of about 16 emblems, e.g. tower, wheat, wolf, star, wave, oak, flame, crown, anvil, ship, moon, eye), `field` from a small set of field patterns (plain, per pale, per bend, chevron, quartered). Used on labels, buildings' flags and the inspector. |
| `civ.setKingdomMotto(id, text)` | Optional, up to 48 characters, shown in the kingdom inspector. |
| `civ.setRelation(aId, bId, 'war' \| 'peace' \| 'alliance')` | Divine diplomacy: declares war, imposes peace, or forges an alliance at once, with chronicle lines. Respects nothing but itself (a god's decree), but the AI may later change it again unless the policy below locks it. |
| `civ.setKingdomPolicy(id, key, value)` | Per-realm overrides of world laws: `expansion` (bool), `warlike` (0–3 multiplier), `rebellions` (bool), `technology` (bool), `growth` (0.25–3), `lockDiplomacy` (bool: AI may not change relations set by the player). `civ.kingdomPolicies(id)` returns current values (defaults = follow world laws). |
| `civ.renameCulture(cultureId, name)` | Renames a culture everywhere it appears. |

## Villages (Civ)

| API | Effect |
|---|---|
| `civ.renameVillage(id, name)` | As above; the label updates. |
| `civ.transferVillage(id, kingdomId)` | Moves a village (and its territory and people) to another kingdom, or to a new independent realm when `kingdomId` is `null`. Chronicle line. |
| `civ.setVillagePolicy(id, key, value)` | `walls` (bool), `growth` (0.25–3), `buildings` (bool: allow new construction), `capital` (true makes it its kingdom's capital). `civ.villagePolicies(id)` returns current values. |

## Creatures (Life: `src/sim/units`)

| API | Effect |
|---|---|
| `units.rename(u, name)` | 1–24 characters. The biography records "Was renamed X by the gods" once. |
| `units.setFavorite(u, on)` | Same flag the inspector star already uses (`u.data.favorite`). |
| `units.addTrait(u, id)` / `units.removeTrait(u, id)` | Existing API. The editor lists every trait in `TRAITS` with its category and description; opposite traits replace each other as they already do. |
| `units.giveItem(u, { slot, kind, material, quality })` | Builds the item with `makeItem` and equips it, replacing the old one (which goes to the village armoury via `civ.depositItem` when possible). `units.itemOptions()` returns the valid slots, kinds, materials and qualities. Legendary quality is allowed for divine gifts but counts toward the legend budget. |
| `units.setUnitFlag(u, key, value)` | `immortal` (no death from age, hunger or damage), `pacifist` (never starts fights), `frozenAge` (stops ageing). Shown as small badges in the inspector. |
| `units.setKingdom(u, kingdomId)` | Moves a person to a village of that kingdom (nearest village); fails for animals. |

## UI (`src/ui`)

- An **Edit** button in the inspector header (kingdom, village and creature views) opens an editing card in the same panel (sheet on phones): name field, colour swatches plus a custom picker (kingdom), banner symbol and field grid (kingdom), motto, diplomacy row with every other living kingdom (war / peace / alliance), policy toggles and sliders, village transfer selector, trait picker with search and categories, item giver, unit flags.
- Changes apply immediately (no save button) with a toast, and are undoable for 10 s from the toast.
- Text inputs must not trigger game hotkeys while focused. 44 px targets on touch.
- The inspector must not re-render the edit card while the player is typing.
