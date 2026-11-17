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
- Pacing on a square Medium map at default research speed: Industrial around
  Year 200–260, Modern around 300–360, Atomic around 400–460, Future after 500.
  Big maps reach each era on a similar schedule (as round 13 tuned for eras 0–3).
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

## Acceptance

- A 600-year Medium run at default speed reaches the Future era in at least
  one realm, with every new unlock visible and announced at least once.
- On Vast, at least one realm reaches the Modern era by Year 400.
- `civEraCap` holds realms at the chosen era.
- Frame and tick cost stay within the round-13 budgets on Medium and Vast
  (see `docs/WORLD-SCALE.md`).
