# Modern and future eras — contract (round 14)

User request: deepen technology and eras into modern and future times, with
new buildings, units, vehicles (ships, fleets, planes, rockets) and
infrastructure that match the new technologies. Every new tech follows the
rule of `docs/TECH-UNLOCKS.md`: it unlocks something the player can **see**
and that **changes what happens**, announced in the chronicle the first time a
realm uses it. All models are original low-poly designs at the scale set by
`docs/WORLD-SCALE.md`.

## Eras

Eras 0–3 (Hearth, Bronze, Iron, Enlightened) are unchanged. Four eras follow:

| id | Era | Look of towns |
|---|---|---|
| 4 | Industrial | Brick, iron and glass; chimneys and smoke |
| 5 | Modern | Concrete, steel and electric light; streets lit at night |
| 6 | Atomic | Glass towers, highways and airports |
| 7 | Future | Arcologies, green towers and clean light |

- Two technologies of an era carry a realm into it (as today).
- Pacing at default research speed, on every map (Medium, Large, the World Map
  and the regional maps), for the first realm into each era:

  | Era | First realm (target year, `ERA_YEAR` in `src/sim/civ/tech.js`) |
  |---|---|
  | Bronze | around Year 45 |
  | Iron | around Year 100 |
  | Enlightened | around Year 160 |
  | Industrial | Year 200–260 (225) |
  | Modern | Year 300–360 (325) |
  | Atomic | Year 400–460 (425) |
  | Future | after Year 500 (515) |

  A realm whose study would carry it into its next era before its year is
  slowed toward it, and the art that would complete the era (its second)
  waits in hand until the realm's own year; the world's leading realm, if
  late, is hurried (up to 2.2 times, times the research speed above 1).
  The other realms follow the leader over the next decades: each realm's own
  year for an era lies up to 55 years after the era's year (a fixed share per
  realm and era), so most realms enter an era 30–60 years after the first;
  a follower past its own year is hurried up to 1.5 times.
  Catch-up from neighbors and the laggard floors only lift realms that are
  behind their own year; they never carry a realm into an era early. Big
  maps' extra research (`BIG_RESEARCH`) is held to the same schedule. A
  faster `civTechSpeed` divides every target year by the speed (round 23:
  eras 1–3 were unpaced before, and the World Map's realms stood in the
  Enlightened era by Year 40–70).
- New World Law `civEraCap` (civilization group): the latest era realms may
  reach, Hearth…Future, default Future. A player who wants a medieval world sets
  Enlightened.
- The building flag that currently reuses `era >= 4` for "gilded" (Civilization.js
  inspector) must move to its own field.

## Technologies (ids are stable; requirements in brackets)

### Industrial (era 4)
| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| `gunpowder` Gunpowder [steelworking, engineering] | Musketeers (soldiers with muskets and smoke puffs); **cannon** replace catapults; star-shaped bastions on walls | Ranged soldiers; sieges faster | Civ + Life (gear) + Fleets (cannon) |
| `steampower` Steam Power [engineering, navigation] | **Steamships**: paddle or screw steamers for trade and transport, with smoke | Faster, larger trade and transport; less weather-bound | Fleets |
| `railways` Railways [steampower, architecture] | **Rail lines** between towns of a realm, stations, **steam trains** | Goods and people move fast along rails (replaces carts on linked towns) | Civ (lines) + Fleets (trains) |
| `industry` Industry [steampower, banking] | **Factories** with chimneys and smoke, workers' row houses | Production and growth; pollution haze near factories | Civ |
| `sanitation` Sanitation [medicine, engineering] | Waterworks, sewers, public baths | Bigger towns, far fewer plague deaths | Civ |
| `ironclads` Ironclads [gunpowder, steampower, steelworking] | **Ironclad** steam warships with cannon | Naval war of the era | Fleets |

### Modern (era 5)
| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| `electricity` Electricity [industry] | **Power stations**, pylons and lines, **street lights and lit windows at night** | Work and research boost | Civ + Render (night lights) |
| `combustion` Combustion Engine [industry, railways] | **Trucks** and **cars** on roads; **motor freighters** | Road haulage replaces carts; civilian traffic in towns | Fleets |
| `flight` Flight [combustion] | **Airfields**; propeller **mail and transport planes**; war **biplanes** that scout and strafe | Air links between a realm's towns; air scouting in war | Fleets (new air layer) |
| `radio` Radio [electricity] | Radio masts with blinking lights | Diplomacy speed; alliances respond faster | Civ |
| `concrete` Reinforced Concrete [industry, architecture] | **Apartment blocks**; cities grow taller | Larger town caps on the same land | Civ |
| `battleships` Battleships [ironclads, electricity] | Steel **battleships** with turrets; **tanks** and **artillery** with armies | Naval and land war of the era | Fleets |

### Atomic (era 6)
| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| `jets` Jet Engines [flight, electricity] | **Airports** with runways; **jet airliners** between realms at peace; **jet fighters** in war | Long-range air trade and travel; air war | Fleets |
| `rocketry` Rocketry [jets, radio] | **Launch pads**; **rockets** lift off with plume and trail; **satellites** cross the night sky as moving points | Research boost per satellite; a chronicle milestone for the first launch | Fleets |
| `computing` Computing [radio, concrete] | Research campuses, glowing screens in windows | Research boost | Civ |
| `containers` Container Shipping [combustion, concrete] | **Container ships**; ports with gantry cranes and stacked containers | Bulk sea trade | Fleets + Civ (port) |
| `skyscrapers` Skyscrapers [concrete, electricity] | **High-rise towers** at city centres | Larger city caps | Civ |
| `carriers` Carriers [battleships, jets] | **Aircraft carriers** that launch and recover jets | Air power at sea | Fleets |
| `nuclear` Nuclear Power [electricity, computing] | Power plants with cooling towers and steam | Large work boost (no weapons) | Civ |

### Future (era 7)
| Tech | Visible unlock | Behaviour | Owner |
|---|---|---|---|
| `fusion` Fusion [nuclear] | Fusion plants with a glowing ring | Work and growth boost; factory haze clears | Civ |
| `maglev` Maglev [railways, fusion] | Elevated **maglev** lines with sleek trains | Very fast links between cities | Civ + Fleets |
| `robotics` Robotics [computing] | **Delivery drones** over towns; robot workers | Build and work boost | Fleets (drones) + Civ |
| `vtol` VTOL Transport [jets, robotics] | **Sky taxis** and VTOL transports between towns | Fast local travel | Fleets |
| `arcology` Arcology [skyscrapers, fusion] | **Arcologies**: vast green tower-cities | Very large city caps | Civ |
| `orbital` Orbital Industry [rocketry, fusion] | **Spaceport** with reusable rockets landing; an **orbital station** visible in the sky | Research and gold | Fleets |
| `starships` Starships [orbital, arcology] | **Colony starships** launched to the stars | A realm's late-game milestone: a launch event with a feed and chronicle entry | Fleets + Civ |

No weapons of mass destruction for realms. God powers stay as they are.

## Units and gear by era

Soldiers' visible gear follows the era: muskets (4), rifles and helmets (5),
modern fatigues and rifles (6), armoured suits (7). Traits, XP and
equipment work as today. Life owns the models; Civ sets the gear.

## Vehicles (Fleets module)

New kinds, each with a model, speed, capacity, health and owner, LOD at
distance and a budget per realm and per world size:

- Sea: `steamer`, `ironclad`, `freighter`, `battleship`, `container`, `carrier`.
- Land: `train` (on rail lines), `truck`, `car`, `tank`, `artillery`, `maglev`.
- Air (new layer, altitude above terrain, straight or gently curved routes,
  no terrain pathing): `plane`, `biplane`, `airliner`, `jet`, `drone`, `skytaxi`.
- Space: `rocket` (launch and land or stage away), `satellite` (orbiting
  point of light), `station`, `starship`.
- Older kinds give way gradually as a realm advances (cogs → steamers →
  freighters → container ships; carts → trains and trucks), never all at once.
- Inspector shows each vehicle; powers work on them; storms ground aircraft.

## Infrastructure (Civ, rendered by Buildings)

Rail lines (along roads between linked towns), stations, highways (wider
roads in era 6+), pylons and power lines, airfields and airports with
runways, container ports with cranes, launch pads and spaceports.
Infrastructure follows the terrain, crosses rivers on bridges, and is
visible at mid zoom; at far zoom it reduces to thin lines.

Round 33, grade caps (heights are world units against a one-unit tile; a
storey is about 0.23): rail at most 1:12, guideways 1:10, highways 1:8.
Surveys pay for climbing (`civPath`'s `climb` over a smoothed ground) and
keep to gentle ground; each laid route's level sits between its all-cut
and all-fill profiles, nearer the cut. Embankments and highway side walls
stand at most about 1.5 storeys; higher, the deck rides on slim piers.
A cut deep enough runs in a tunnel (no track drawn; a covered way and a
headwall at each mouth; `seg.tun`, highways `seg.htun`, levels `seg.hy`),
a shallow one is filled so the line rides over the rise at the grade. A
route that still breaks the grade, or would need piers over about fourteen
storeys, is searched again with climbing dearer and refused if it fails.

## Acceptance

- A 600-year Medium run at default speed reaches the Future era in at least
  one realm, with every new unlock visible and announced at least once.
- On Vast, at least one realm reaches the Modern era by Year 400.
- `civEraCap` holds realms at the chosen era.
- Frame and tick cost stay within the round-13 budgets on Medium and Vast
  (see `docs/WORLD-SCALE.md`).

## Round 14 additions

See `docs/TECH-BREADTH.md` for the food, medicine, biome, city-development
and urban-planning branches, urban renewal and heritage, the new units
(firefighters, doctors, tractors, fire engines, ambulances, trams, rescue
helicopters), the advanced boats (tankers, cruise liners, icebreakers,
submarines, patrol boats, hovercraft, hydrofoils, research vessels, solar
trimarans, autonomous cargo ships) and the new "Technology" god powers.
