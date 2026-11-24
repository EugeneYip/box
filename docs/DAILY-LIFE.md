# Daily life — contract (round 14)

User request: on top of wandering, resting and working (chopping wood,
harvesting, mining, building), people should have realistic everyday
activities, such as singing, sleeping, socializing, courting and raising
families, walking, eating, laughing, relieving themselves, waiting and
thinking.

## Activities

Each activity has a cause in the simulation, a visible pose or small
animation near the camera, and a label for the inspector's "Doing" line.

| Activity | When | Visible | Label examples |
|---|---|---|---|
| Sleeping | At night at home; naps when exhausted | Indoors (not drawn) or lying down outdoors; "z" puffs near camera | "Sleeping", "Napping" |
| Eating | Meals at morning, midday and evening; when hungry | Sitting or standing with food, hand to mouth | "Eating breakfast", "Having supper" |
| Socializing | With friends, family or neighbors nearby, at the square, market or tavern | Two to five people face each other, gestures | "Chatting with Aiko", "Gossiping at the market" |
| Laughing | During socializing, at festivals, when content | Shoulders shake, small burst | "Laughing" |
| Singing | At work in fields, at festivals and in temples; children at play | Head up, music notes near camera | "Singing", "Singing at the harvest" |
| Dancing | Festivals, weddings, golden ages | Circle dance | "Dancing" |
| Walking | Purposeful trips: to work, home, market, visiting family (distinct from aimless wandering) | Steady walk on roads | "Walking to the market", "Walking home" |
| Courting | Adults who are partners or attracted (existing relationships) | Pairs walk together, sit together, small heart near camera | "Courting Mei", "Walking with partner" |
| Raising a family | Parents with young children | Parent near child, carrying an infant | "Minding the children" |
| Playing | Children | Running games, tag, ball | "Playing tag" |
| Praying | At temples; in hard times | Kneeling or bowing | "Praying" |
| Thinking | Scholars, rulers, idle elders | Hand to chin, pause | "Thinking", "Pondering the stars" |
| Reading | Literate people with libraries, modern eras | Book or screen in hand | "Reading" |
| Waiting | At a harbour for a ship, at a station for a train, in a queue at a market | Standing still facing the arrival point | "Waiting for the ship" |
| Shopping / trading | At markets | Standing at a stall | "Buying bread" |
| Relieving oneself | Every so often, discreetly | The person walks to a privy, outhouse or restroom (or behind a bush in the wild) and is out of sight briefly; never depicted | "Visiting the privy" (modern eras: "Visiting the restroom") |
| Grieving | After a family member dies | Head bowed at a grave or home | "Mourning Tomas" |
| Celebrating | Births, weddings, victories, festivals | Raised arms, cheers | "Celebrating a wedding" |

Existing labels (fighting, fleeing, fishing, riding, tending the sick, and the
work labels) stay.

## Rules

- A daily rhythm: sleep at night, meals at three times, work in daylight, social time in the evening and on festival days. Seasons and weather shift it (less time outdoors in rain and snow).
- Needs drive choices: hunger leads to eating, low energy to sleep, social need (new, cheap) to socializing; content people laugh and sing more, miserable ones grieve or sit alone.
- Activities are visible only near the camera (poses and small icons, batched); far away they are labels and cheap state changes, so the tick budget of `docs/WORLD-SCALE.md` holds.
- Animals get their own small set where it fits (grazing, sleeping, playing young, courting in spring).
- Courting and families use the existing relationships and births; nothing explicit is shown.
- Soldiers (round 17): half are on duty. By day they walk between the posts (towers, gates, walls, barracks, the hall), stand guard there ("Guarding the gate", "Keeping watch from the tower") and drill ("Drilling in the barracks yard"); at night they sleep in the barracks (else at home) and one guard in four keeps the night watch (one in two in war, round 29). The off-duty half rest in the barracks or drill in its yard (with no barracks: at home, on the square or at the hall). Soldiers take the woodcutter's work only while the town is short of wood. Nobody does daytime work at night except the night watch.
- Drill (round 23): each town has one parade square, on any side of the barracks (else the hall) where level ground is free. In the drill hours (08:00–11:00, 13:30–16:20) 6–12 soldiers stand on it in two ranks of six, facing the building, until the drill ends: the off-duty half fill it to twelve, guards on duty top it up to six. No drill in war.
- The evening square (round 23): from 18:00 to 21:30, 8–15 grown-ups keep each town's main square in groups round a musician, at the food stall and on the benches. About sixteen "regulars" a night (a different few each day) stay up until 21:30 whatever the season or weather, and anyone deciding inside the window goes there while it holds fewer than eight (regulars: fewer than fifteen), so the crowd is there after a jump of the clock too.
- Battles (round 23): soldiers with guns form a front line for each side across the axis between the two sides and fire from it; Modern and later soldiers fight on foot; only the selected fighter shows a ring.
- Toddlers (under five, round 35) keep to their family's house: born at its door, by day indoors with the family or at play by the door, and they join only a celebration at their door.
- Children play, go to school and help lightly (drawing water, feeding the hens, minding the animals); no field work. The jobless spend the working day at home, visiting neighbors, or (modern towns) at the office, factory or lab, so a square holds a few dozen at most; evening groups spread over the main square, the hall, a park and the temple in big towns.
- A tsunami runs a few tiles inland over low shore and hits unguarded lowland towns in proportion to their share of low ground; levees break it.

## Acceptance

- Following a person for a game day shows at least six different activities with sensible timing.
- At a busy town square in the evening, a camera close-up shows groups chatting and laughing, someone singing, children playing.
- The tick budget still holds.
