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

## Acceptance

- Following a person for a game day shows at least six different activities with sensible timing.
- At a busy town square in the evening, a camera close-up shows groups chatting and laughing, someone singing, children playing.
- The tick budget still holds.
