# Nocturne — Comprehensive Design

**Status:** Full-scope design document. Builds on existing codebase (Nocturne-chat-dashboard monorepo).  
**Principle:** Every system is designed; nothing is "figure it out later." But systems are designed for the whole scope, not prototype-scoped.

---

## 1. World Architecture

### 1.1 Location Graph

The world is a directed graph of locations connected by travel edges. Already partially modeled via `entity_relations` with `located_within` — extend to support:

```
location types:
  - city          (top-level container)
  - district      (neighborhood cluster, e.g., "Foundry Ward", "Financial District", "Docks")
  - neighborhood  (walkable area, e.g., "Foundry Row", "Chinatown", "Upper Heights")
  - street        (connects neighborhoods, vehicles possible)
  - building      (has interior rooms)
  - room          (individual space within building)
  - exterior      (alley, rooftop, parking lot, pier, park)
  - transit_node  (subway station, bus stop, ferry terminal, highway on-ramp)
  - residence     (player-owned or rented living space — already modeled)
  - business      (store, warehouse, office — has business_type)
```

**Travel edges:**

```yaml
relation_type options:
  - located_within # room → building, building → neighborhood, etc.
  - adjacent_to # same-level connection (room↔room, street↔street)
  - accessible_via # through a transit node
  - requires_keycard # restricted access
  - requires_breakin # locked but bypassable
  - requires_credential # guard, membership, badge
```

**Travel time:** Each edge has a base travel time in seconds. Walking: 30-300s per edge. Driving: 10-60s. Transit: schedule-based.

### 1.2 Travel Resolution

Not a grid. A directed graph stored in `entity_relations`. The existing location-store already has recursive CTE queries for containment. Travel extends the same pattern.

**Data model:**

```yaml
# Travel edge — stored as entity_relation row:
relation_type: "adjacent_to" | "accessible_via"
source_instance_id: location_a
target_instance_id: location_b
parameters:
  travel_time_seconds: 30           # walking time for this edge
  distance_meters: 150              # optional, for narration
  requires: null | "keycard" | "breakin" | "credential"
  transit_line: null | "red_line"   # for accessible_via edges
  vehicle_allowed: true             # can you drive this edge?
```

**Pathfinding:**

```
move action:
  1. GROUND: resolve current_location and destination_location against DB
  2. PATHFIND: Dijkstra on entity_relations graph, edges filtered by:
     - character access (keycard? credential? breakin skill?)
     - vehicle capability (on foot vs. car vs. motorcycle)
  3. TIME: sum(travel_time_seconds) × vehicle_speed_factor × sneak_factor
  4. EXPOSE: each edge traversed creates visibility windows (who saw you?)
  5. SCHEDULE: action duration = total time, resolves_at = now + duration
  6. NARRATE: AI names the route ("Calder Ave to Midtown, then dock road")
```

**Speed modifiers:**

| Method               | Time factor    | Visibility                |
| -------------------- | -------------- | ------------------------- |
| Walking              | 1.0×           | Normal                    |
| Running              | 0.5×           | High (attracts attention) |
| Sneaking             | 1.5×           | Low                       |
| Car                  | 0.3×           | Normal                    |
| Motorcycle           | 0.2×           | Normal                    |
| Taxi                 | 0.3×           | Driver is a witness       |
| Transit (bus/subway) | Schedule-based | Public                    |

**AI's role in travel:** Parse "drive to the docks." The rules engine computes the path and time. The AI gets back "23 minutes via Calder Ave → Midtown → Dock Road" and narrates it. The AI never invents routes, distances, or travel times.

**Example — cross-district move:**

```
Player: "I drive from my apartment in Foundry Row to the Waterfront fish market"
System:
  - Path: Foundry Row → Foundry Ward main street → Midtown bypass → Waterfront → Fish Market
  - Edges: 4 × 60s = 240s base walking → ×0.3 (car) = 72s
  - Narrated: "About a minute and change. You take Foundry Ave through Midtown,
    the docks coming into view as you round the old cannery."
```

**ponytail:** The location graph is a single Postgres recursive CTE. Dijkstra in SQL for <200 locations runs in <1ms. Skip graph DB, skip in-memory graph library. Replace with pgRouting only if location count exceeds 10,000.

### 1.3 City Template

Calder City — a full Atlantic coastal metropolis. Not just one neighborhood. The seeded starter world becomes one entry point.

| District           | Vibe                    | Key locations                                                          |
| ------------------ | ----------------------- | ---------------------------------------------------------------------- |
| Foundry Ward       | Industrial, affordable  | Apartments, repair shops, warehouses, dive bars                        |
| Financial District | Corporate, policed      | Banks, law firms, corporate HQs, courthouse, upscale restaurants       |
| Old Town           | Historic, tourist-heavy | Museums, galleries, theaters, boutique hotels, consulates              |
| Waterfront         | Port, crime-heavy       | Docks, shipping offices, fish market, smuggling routes, ferry terminal |
| University Heights | Academic, young         | Campus, research labs, student housing, coffee shops, bookstores       |
| Hospital Row       | Medical, quiet          | Hospital, clinics, pharmacy, medical supply, morgue                    |
| Midtown            | Commercial, busy        | Mall, chain stores, parking garages, hotels, convention center         |
| The Gardens        | Wealthy, gated          | Mansions, private security, country club, luxury dealership            |
| Ironbridge         | Heavy industry          | Factories, railyard, power plant, scrap yards, union halls             |
| Redlights          | Entertainment, vice     | Nightclubs, casinos, pawn shops, cheap motels, tattoo parlors          |
| City Hall District | Government              | City hall, police HQ, records office, jail, federal building           |

### 1.3 All City Stores

Every store type a real city has. Each has a `business_type` and a known inventory category.

| Category                  | Store types                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Food**                  | Grocery store, convenience store, bakery, butcher, fish market, farmer's market, restaurant (fast food, diner, upscale, ethnic), bar, coffee shop, liquor store |
| **Retail**                | Department store, clothing boutique, electronics shop, bookstore, toy store, music store, pawn shop, antique shop, flea market                                  |
| **Hardware**              | Hardware store, lumber yard, plumbing supply, electrical supply, paint store, tool rental                                                                       |
| **Automotive**            | Gas station, auto repair shop, tire shop, car dealership (new/used), motorcycle shop, scrapyard, tow lot, car wash, auto parts store                            |
| **Medical**               | Hospital, urgent care clinic, pharmacy, dentist, optometrist, veterinary clinic, medical supply store                                                           |
| **Professional services** | Law firm, accounting office, insurance agency, real estate office, bank, credit union, post office, shipping/courier store, print shop                          |
| **Personal services**     | Barber, salon, tattoo parlor, gym, laundromat, dry cleaner, tailor, locksmith, phone repair                                                                     |
| **Security**              | Locksmith, security system installer, gun shop (licensed), guard service office, private investigator                                                           |
| **Entertainment**         | Movie theater, arcade, bowling alley, pool hall, comedy club, concert venue, sports stadium                                                                     |
| **Travel**                | Bus station, subway station, ferry terminal, airport (edge of city), taxi dispatch, car rental                                                                  |
| **Industrial**            | Factory, warehouse, distribution center, recycling plant, water treatment, power substation                                                                     |
| **Institutional**         | Police precinct, fire station, courthouse, city hall, DMV, library, post office, jail, military recruiting                                                      |
| **Underground**           | Illegal gambling den, unlicensed gun dealer, chop shop, safehouse, drug house, forgery operation, smuggling front                                               |

**Ponytail rule for stores:** Each store knows its inventory _categories_, not item-level stock. The AI fills in reasonable items from those categories when needed. No supply/demand simulation yet.

### 1.4 Housing

| Type                  | Acquisition                                           | Examples                                                |
| --------------------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Rental apartment      | Pay rent (in-game currency, periodic)                 | Ashdown Apartments, tenement housing, mid-rise condos   |
| Owned condo           | Purchase deed                                         | Midtown towers, waterfront lofts                        |
| House                 | Purchase deed                                         | Gardens mansions, Old Town brownstones, suburban houses |
| Commercial property   | Purchase deed or lease                                | Warehouses, storefronts, offices                        |
| Hidden/squat          | Claim via gameplay (no deed)                          | Abandoned factory, sewer hideout, condemned building    |
| Institutional housing | Assigned (police barracks, prison cell, hospital bed) | Temporary, conditional                                  |

Each residence has capacities (space, power, concealment, security, access) — already modeled in schema, just needs values assigned per location type.

---

## 2. Character System

### 2.1 Skills and Experience

Characters have skills. Skills gate item creation difficulty and action success. Nothing is truly "impossible" — just impractical at low levels via extreme time requirements.

```
skill categories:
  - engineering     (building devices, repairing)
  - chemistry       (compounds, explosives, drugs)
  - electronics     (wiretapping, jamming, decryption)
  - mechanics       (vehicles, locks, safes)
  - medicine        (healing, forensics, poisoning)
  - combat          (melee, firearms, improvised)
  - stealth         (sneaking, pickpocketing, hiding)
  - investigation   (searching, analyzing evidence, profiling)
  - persuasion      (intimidation, charm, negotiation, deception)
  - driving         (cars, motorcycles, trucks, boats)
  - hacking         (computer systems, security bypass)
  - athletics       (climbing, swimming, sprinting, endurance)
  - streetwise      (knowing who's who, finding illegal goods, sensing danger)
```

**Skill scale:** 0-100. 0 = untrained. 25 = novice. 50 = competent. 75 = expert. 100 = world-class.

**Starting skills:** Everyone starts at 0 across all skills. No backgrounds, no head starts.

**Progression curve:** Quadratic — early levels fast, later levels slow. Total XP needed to reach level N = N² × 10.

| Level             | Total XP | Approx actions | ~Play time |
| ----------------- | -------- | -------------- | ---------- |
| 10 (basic)        | 1,000    | ~330           | ~3 hours   |
| 25 (novice)       | 6,250    | ~2,100         | ~18 hours  |
| 50 (competent)    | 25,000   | ~8,300         | ~70 hours  |
| 75 (expert)       | 56,250   | ~18,750        | ~6 days    |
| 100 (world-class) | 100,000  | ~33,300        | ~12 days   |

Assumes: average action = 3 XP, average action takes ~30 seconds, 8-hour play sessions. Comparable to RuneScape's ~100-200 hours to 99 per skill. Competent (~70 hours) is achievable in a week of dedicated play. Maxing every skill would take thousands of hours — impossible to be world-class at everything.

**XP gain per action:** XP = action difficulty rating (1-10), determined by the AI during parsing. Using a skill successfully always grants at least 1 XP.

**AI-determined creation difficulty:** When a player proposes an item:

1. AI parses the concept into a `GeneratedDefinitionDraft` (already built)
2. AI assigns a `creationDifficulty` (0-100) based on: complexity of effects, required precision, exotic materials, power requirements, miniaturization
3. The player's relevant skill vs. `creationDifficulty` determines build time:
   - skill ≥ difficulty: base build time (AI-assigned)
   - skill ≥ difficulty - 20: 3× build time
   - skill ≥ difficulty - 40: 10× build time
   - skill ≥ difficulty - 60: 50× build time
   - skill < difficulty - 60: time scales exponentially (years at extreme gaps)
4. Nothing is ruled out. The player is told estimated time and can choose. "Building a nuclear bomb with no engineering knowledge would take decades. You set it aside."
5. Nuclear bomb: difficulty ~95. Engineering 75+ required for reasonable timeline. A skill-0 character sees "~80 years estimated." They won't do it — but the system hasn't forbidden it.

### 2.2 Character State

Already well-modeled in schema. Add:

```
- injuries[]          (type, severity, body_part, healing_eta)
- status_effects[]    (drugged, exhausted, terrified, enraged, concussed, bleeding, handcuffed, blindfolded)
- carried_items[]     (references to entity_instances)
- worn_items[]        (clothing, armor, disguises)
- currency            (multiple: cash, bank_balance, crypto_wallet)
- active_vehicles[]   (vehicles the character has keys to and knows location of)
- known_locations[]   (locations the character has visited or learned about)
- active_commitments[] (meetings, deadlines, promises tracked by the system)
```

---

## 3. Time System

### 3.1 Real-Time Core

World time advances in real time. Actions have durations. The world doesn't pause when nobody is looking.

**Database:** `world_time` column on event_ledger already exists. Use it as the authoritative tick.

**Durations:** Every action gets a `started_at`, `estimated_duration_seconds`, and `resolves_at`. The action isn't complete until wall clock reaches `resolves_at`.

| Action type                        | Duration range                |
| ---------------------------------- | ----------------------------- |
| Send a text message                | 5-30s                         |
| Search a room                      | 30-300s                       |
| Drive across district              | 60-600s                       |
| Build a simple device              | 600-3600s (10min-1hr)         |
| Build a complex device             | 3600-86400s (1hr-24hr)        |
| Heal from minor injury             | 3600-21600s (1-6hr)           |
| Heal from major injury             | 86400-604800s (1-7 days)      |
| Prison sentence                    | 86400-2592000s (1-30 days)    |
| Travel by transit (schedule-based) | varies by route and wait time |

### 3.2 Scheduling

Players can schedule actions:

- "I'll surveil the bank from my car starting at 2am for 3 hours"
- "Deliver the package at noon tomorrow"

The worker process (already has `apps/worker/src/index.ts`) checks for due actions and resolves them. Player doesn't need to be online.

### 3.3 In-Game Clock

Calder City has a day/night cycle tied to real time. 1 real day = 1 game day (or configurable ratio). Time of day affects:

- Store open/closed status
- NPC availability (at work vs. at home vs. asleep)
- Visibility (darkness modifier for actions)
- Police patrol density
- Traffic (travel time modifier)

---

## 4. Items and Inventory

### 4.1 Item Categories

All items are `entity_instances` with a `definition_id`. Already modeled.

| Category        | Examples                                                                      |
| --------------- | ----------------------------------------------------------------------------- |
| **Weapons**     | Pistol, rifle, knife, bat, taser, pepper spray, improvised                    |
| **Tools**       | Lockpicks, crowbar, wire cutters, drill, laptop, USB drive                    |
| **Electronics** | Phone, burner phone, radio, scanner, camera, bug, jammer                      |
| **Disguise**    | Uniform, mask, wig, fake ID, badge                                            |
| **Medical**     | Bandages, painkillers, antidote, stimulant, sedative                          |
| **Clothing**    | Casual, business, tactical, formal, gang colors                               |
| **Vehicles**    | Car, motorcycle, truck, van, boat (vehicle is an item with a `vehicle` trait) |
| **Keys/Access** | Keycards, keys, access codes, passwords                                       |
| **Documents**   | Deeds, contracts, letters, photographs, ledgers, flash drive                  |
| **Contraband**  | Drugs, stolen goods, counterfeit money, unregistered weapons                  |
| **Materials**   | Scrap metal, wire, chemicals, electronics parts, fabric                       |
| **Food/Drink**  | Consumable, minimal mechanical effect (RP value)                              |
| **Money**       | Cash (physical item), credit cards, crypto wallet                             |

### 4.2 Item Creation (Invention Pipeline)

Already built: `invention-store.ts` handles `generated_content_requests` flow. Extend with skill gating:

```
1. Player describes concept → "I want to build a grappling hook"
2. AI parses into GeneratedDefinitionDraft (existing)
3. AI assigns:
   - creationDifficulty: 45
   - requiredSkills: { engineering: 40 }
   - requiredMaterials: [{ category: "metal_cable", quantity: 1 }, { category: "spring_mechanism", quantity: 1 }, { category: "grip_handle", quantity: 1 }]
   - requiredTools: [{ name: "workshop", minCondition: 50 }]
   - estimatedBuildTimeSeconds: 2700 (45 minutes)
   - acquisitionPath: { type: "built", stages: 1 }
4. System checks:
   - Does player have required skill levels?
   - Does player have materials in inventory or residence?
   - Does player have required tools/workspace?
   - If yes: creation begins, timer starts
   - If no: player is told what's missing
5. When timer expires: item instance created in player's residence
6. Quality determined by: skill margin over difficulty + random factor
   - Far above difficulty: better condition, bonus effects
   - At difficulty: standard result
   - Barely above: flawed (reduced condition, possible malfunction risk)
```

### 4.3 Acquisition

Items can be obtained through multiple paths (already in schema as `AcquisitionPathSchema`):

| Path          | Mechanism                                                             |
| ------------- | --------------------------------------------------------------------- |
| **Purchased** | Buy from store NPC or other player                                    |
| **Built**     | Invent + construct with materials and time                            |
| **Found**     | Discovered during exploration/search                                  |
| **Stolen**    | Taken from location or NPC via stealth/force                          |
| **Given**     | Transferred by another player or NPC                                  |
| **Inherited** | Received when previous character dies (if designated)                 |
| **Issued**    | Given by employer/faction (police badge, gang colors, company laptop) |

### 4.4 Condition and Degradation

Items have `condition` (0-100, already in schema). Usage degrades condition. At 0, item breaks.

---

## 5. Vehicle System

### 5.1 Vehicle as Entity

A vehicle is an `entity_instances` with `definition_type: "vehicle"`. It has:

- Location (where it's parked/docked)
- Owner
- Keys (separate item entity, or hotwiring bypass)
- Condition
- Fuel/charge level
- Trunk inventory (vehicles are also containers)
- Speed modifier (affects travel time)
- Seats (how many passengers)
- Concealment (tinted windows, hidden compartments)
- Registration (tied to identity — stolen vehicles have heat)

### 5.2 Vehicle Actions

```
- drive <vehicle> to <location>     (duration based on distance, traffic, vehicle speed)
- park <vehicle> at <location>
- hotwire <vehicle>                 (mechanics skill check)
- search <vehicle's trunk>
- stash <item> in <vehicle's glovebox/trunk>
- abandon <vehicle>
- report <vehicle> stolen
- scrap <vehicle> for parts
- refuel <vehicle>
- repair <vehicle>                  (mechanics skill, parts required)
```

### 5.3 Vehicle Sources

| Source         | Cost       | Heat risk              |
| -------------- | ---------- | ---------------------- |
| Dealership     | High       | None (registered)      |
| Private sale   | Medium     | Low                    |
| Street (steal) | Free       | High (reported stolen) |
| Chop shop      | Medium-Low | Medium (VIN swapped)   |

---

## 6. NPC System

### 6.1 Static NPCs (Shops/Vendors)

These are simple: they exist at a location, have a `business_type`, and know their inventory categories. No AI needed for basic transactions.

```
NPC: "Grocery Store Clerk"
  location: "Foundry Row Grocery"
  business_type: "grocery_store"
  inventory_categories: ["food", "drink", "household_supplies"]
  operation: always present during store hours
  behavior: sells items from inventory at listed prices, buys nothing
```

### 6.2 Routine NPCs (City Population)

Background NPCs follow schedules. They're records, not running AI agents:

```yaml
npc_definition:
  name: "Marco Vazquez"
  role: "dock worker"
  schedule:
    - {
        location: "Foundry Row Apartments #2B",
        days: "weekdays",
        time: "22:00-06:00",
        activity: "sleeping",
      }
    - {
        location: "Waterfront Docks, Pier 4",
        days: "weekdays",
        time: "07:00-16:00",
        activity: "working",
      }
    - { location: "Rusty Anchor Bar", days: "weekdays", time: "17:00-20:00", activity: "drinking" }
    - { location: "Foundry Row", days: "weekdays", time: "20:00-22:00", activity: "commuting" }
  relationships:
    - { target: "Elena Vazquez", type: "married_to" }
    - { target: "Dock Workers Union Local 412", type: "member_of" }
  knowledge: [] # populated by events they witness
```

**NPC AI invocation is lazy:** Only when a player interacts with an NPC does the AI "wake up" that NPC, generate dialogue from their state, and commit any resulting changes. Between interactions, they're just database rows with schedules.

### 6.3 Faction NPCs

Major NPCs with agency. They have goals, make decisions, and drive faction activity.

```yaml
npc: "Captain Elaine Cross"  (Police Precinct 12 commander)
  faction: "Calder City Police Department"
  rank: "Captain"
  personality:
    worldview: "The city is winnable with enough discipline."
    core_desire: "Clean up Foundry Ward before retirement."
    core_fear: "Being exposed as having covered for a dirty cop early in her career."
    contradiction: "Believes in law but has broken it to protect her unit."
    moral_lines: ["won't kill", "won't frame an innocent", "won't betray her officers"]
    status_strategy: "authority"
  knowledge: [populated from information_assets table]
  current_goal: "Identify the supplier of illegal firearms in Foundry Ward"
```

NPC AI runs on a schedule (every N minutes, or when triggered by relevant events). It checks their goals, observes new information they have access to, and can initiate actions:

- Order subordinates to investigate
- File reports
- Meet with informants
- Issue warrants (if legal authority)
- Arrest suspects

### 6.4 NPC Stores — Complete List for Calder City

Every store that belongs in a city, mapped to locations:

| District               | Store                                     | Type               | Known Inventory                                       |
| ---------------------- | ----------------------------------------- | ------------------ | ----------------------------------------------------- |
| **Foundry Ward**       |                                           |                    |                                                       |
|                        | "Mick's Hardware"                         | hardware_store     | tools, materials, paint, lumber, plumbing, electrical |
|                        | "Foundry Row Grocery"                     | grocery_store      | food, drink, household                                |
|                        | "24/7 Convenience"                        | convenience_store  | snacks, drinks, basic supplies, prepaid phones        |
|                        | "Foundry Auto Repair"                     | auto_repair        | car parts, tires, tools, mechanic service             |
|                        | "Ironbridge Scrap & Salvage"              | scrapyard          | scrap metal, used parts, junk vehicles                |
|                        | "The Rusty Anchor"                        | bar                | drinks, food (basic)                                  |
|                        | "Calder Pawn & Loan"                      | pawn_shop          | random used items, jewelry, electronics, tools        |
|                        | "Foundry Wash"                            | laundromat         | laundry service                                       |
|                        | "St. Jude's Free Clinic"                  | clinic             | basic medical supplies, treatment                     |
| **Financial District** |                                           |                    |                                                       |
|                        | "Calder First Bank"                       | bank               | accounts, loans, safe deposit boxes                   |
|                        | "Harrington & Associates"                 | law_firm           | legal services                                        |
|                        | "City Courier Services"                   | shipping           | package delivery, mail                                |
|                        | "TechVault Electronics"                   | electronics        | phones, laptops, surveillance equipment, bugs         |
|                        | "The Vault"                               | upscale_restaurant | food (expensive)                                      |
|                        | "Calder Arms Hotel"                       | hotel              | lodging, room service                                 |
|                        | "Executive Wardrobe"                      | clothing_boutique  | business attire, formal wear                          |
| **Old Town**           |                                           |                    |                                                       |
|                        | "Old Town Books"                          | bookstore          | books, maps, research materials                       |
|                        | "The Conservatory"                        | museum             | tours, events                                         |
|                        | "Antiquities & Curios"                    | antique_shop       | rare items, old documents, collectibles               |
|                        | "Old Town Theater"                        | theater            | entertainment                                         |
|                        | "Embassy Row Hotel"                       | hotel              | lodging (luxury)                                      |
| **Waterfront**         |                                           |                    |                                                       |
|                        | "Harbor Fish Market"                      | fish_market        | seafood, ice                                          |
|                        | "Pier Supply Co."                         | marine_supply      | rope, tarps, boat parts, fishing gear                 |
|                        | "The Shipping Office"                     | shipping_office    | cargo, customs, import/export                         |
|                        | "Waterfront Bar"                          | bar                | drinks (cheap)                                        |
|                        | "Calder Ferry Terminal"                   | ferry_terminal     | transit tickets                                       |
|                        | "Dock Workers Union Hall"                 | union_office       | membership, job board                                 |
| **Hospital Row**       |                                           |                    |                                                       |
|                        | "Calder General Hospital"                 | hospital           | medical treatment, pharmacy, surgery                  |
|                        | "MedPlus Pharmacy"                        | pharmacy           | prescription drugs, medical supplies                  |
|                        | "Calder Morgue"                           | morgue             | body storage, autopsy records                         |
| **Midtown**            |                                           |                    |                                                       |
|                        | "Midtown Mall" (contains multiple stores) | mall               | clothing, electronics, food court, department store   |
|                        | "Midtown Parking Garage"                  | parking            | vehicle storage                                       |
|                        | "Calder Convention Center"                | convention_center  | events                                                |
|                        | "Greyhound Station"                       | bus_station        | transit tickets                                       |
| **The Gardens**        |                                           |                    |                                                       |
|                        | "The Gardens Country Club"                | club               | dining, golf, social events                           |
|                        | "Prestige Auto"                           | luxury_dealership  | high-end vehicles                                     |
|                        | "Gardens Private Security"                | security_service   | guards, alarm systems                                 |
| **Ironbridge**         |                                           |                    |                                                       |
|                        | "Calder Power & Electric"                 | power_plant        | (not a store — infrastructure)                        |
|                        | "Ironbridge Rail Yard"                    | railyard           | cargo, freight access                                 |
|                        | "Union Ironworks"                         | factory            | industrial equipment, bulk metal                      |
| **Redlights**          |                                           |                    |                                                       |
|                        | "Neon Pawn"                               | pawn_shop          | used items, questionable provenance                   |
|                        | "Redlights Tattoo"                        | tattoo_parlor      | tattoos                                               |
|                        | "The Velvet Room"                         | nightclub          | drinks, entertainment                                 |
|                        | "Cash 4 Gold"                             | pawn_shop          | gold, jewelry                                         |
|                        | "Budget Inn"                              | cheap_motel        | lodging (hourly/daily, no questions)                  |
| **City Hall District** |                                           |                    |                                                       |
|                        | "Calder City Hall"                        | government         | permits, records, licenses                            |
|                        | "Police HQ — Precinct 1"                  | police_hq          | law enforcement HQ                                    |
|                        | "Calder County Courthouse"                | courthouse         | legal proceedings, records                            |
|                        | "Calder County Jail"                      | jail               | detention                                             |
|                        | "Calder Post Office — Main"               | post_office        | mail, PO boxes                                        |
|                        | "Federal Building"                        | federal_offices    | federal services, FBI field office                    |
| **University Heights** |                                           |                    |                                                       |
|                        | "Calder University Bookstore"             | bookstore          | textbooks, supplies                                   |
|                        | "Campus Coffee"                           | coffee_shop        | coffee, pastries, wifi                                |
|                        | "University Research Lab"                 | research_lab       | specialized equipment (restricted access)             |
|                        | "Campus Pharmacy"                         | pharmacy           | medical supplies                                      |

### 6.5 Underground / Illegal Operations

These exist but aren't advertised. Players discover them through contacts, streetwise skill, or investigation:

| Operation                 | Location                       | Services                              |
| ------------------------- | ------------------------------ | ------------------------------------- |
| Unlicensed gun dealer     | Redlights back room            | Unregistered weapons                  |
| Chop shop                 | Ironbridge warehouse           | Vehicle theft/dismantle, VIN swapping |
| Forgery operation         | Old Town basement              | Fake IDs, documents, credentials      |
| Drug house                | Foundry Ward tenement          | Illegal substances                    |
| Illegal gambling den      | Waterfront back office         | Unregulated betting                   |
| Black market organ dealer | Hospital Row (corrupt orderly) | Medical supplies, transplant organs   |
| Money launderer           | Midtown (front business)       | Cleaning illicit cash                 |
| Fixer/Info broker         | Redlights nightclub            | Information, contacts, introductions  |
| Safehouse operator        | Various                        | Hiding place for fugitives            |

---

## 7. Communication System

### 7.1 Scope

**Current phase:** DM with user only. One character per user talks to the game/NPCs. No player-to-player chat yet.

### 7.2 Channels (designed, implemented later)

Already designed in FOUNDATION.md. Each communication is a database event with:

```yaml
communication:
  channel: face_to_face | phone_call | sms | encrypted_message | email | radio | dead_drop | courier | note | public_broadcast | police_radio
  sender_device: entity_id (phone, radio, etc.)
  sender: character_id
  recipients: [character_id, ...]
  content: string
  metadata:
    duration_seconds: (for calls)
    encrypted: boolean
    coded_language: boolean
    requires_context: (what you need to know to understand it)
  observers: [character_id, ...] # who could have intercepted
  recorded_by: [system_id, ...] # carrier metadata, surveillance
  timestamp: world_time
```

### 7.2 Interception

Not random. An observer must have:

1. Access to the channel (e.g., wiretap on phone, bug in room, person at the bar overhearing)
2. Capability (surveillance equipment, decryption tools, or just good ears)
3. Time window (must be present during the communication)

If all three are met → observer gains an `information_asset` with the content (possibly partial/uncertain).

### 7.3 Device Tracking

Every device leaves a trail:

- Cell towers record approximate location
- Carrier records calls and SMS metadata
- Police with a warrant can access these records
- Burner phones reduce but don't eliminate this (purchased with cash, used briefly, discarded)

---

## 8. Economy

### 8.1 Currency

```
- Cash           (physical item, untraceable, bulk caps)
- Bank account   (traceable, large amounts, earns interest, can be frozen/seized)
- Crypto wallet  (semi-traceable, volatile value, requires exchange to cash out)
- Barter         (item-for-item, no trail)
```

### 8.2 Income Sources

| Source             | Mechanism                                                                    |
| ------------------ | ---------------------------------------------------------------------------- |
| Employment         | NPC employer pays salary (cop, dock worker, lawyer, journalist, etc.)        |
| Business ownership | Revenue from owned stores/properties                                         |
| Crime              | Robbery, theft, drug dealing, extortion, heists                              |
| Services           | Other players pay for skills (lockpicking, hacking, medical, legal, driving) |
| Bounties           | Police or faction rewards                                                    |
| Investments        | Stock market, real estate appreciation                                       |
| Gambling           | Casinos, underground betting, fight clubs                                    |

### 8.3 Player Marketplace

Players list items for sale. Other players browse and buy. Like eBay for the game world.

```
marketplace listing:
  seller: character_id
  item: entity_instance_id
  price: amount (seller sets their own price)
  currency: cash | bank_transfer
  listed_at: timestamp
  expires_at: timestamp (auto-delist after N days)
  status: active | sold | cancelled
```

- Seller sets price freely. No centralized price controls.
- Buyer pays listed price, item transfers on purchase.
- In-person trades/deals come later.

### 8.4 Expenses

| Expense       | Mechanism                                        |
| ------------- | ------------------------------------------------ |
| Rent/Mortgage | Periodic, location-dependent                     |
| Food          | Required or character gets hungry (minor debuff) |
| Medical care  | Injury treatment costs money                     |
| Vehicle       | Fuel, insurance, repairs, registration           |
| Equipment     | Weapons, tools, devices — consumable or degrade  |
| Legal fees    | Lawyers, bail bondsmen, fines                    |
| Bribes        | Paying off officials, informants                 |
| Faction dues  | Union dues, gang tribute, protection money       |

---

## 9. Legal System

### 9.1 Crimes

Every action that violates law generates a potential charge. Not automatic — requires detection.

| Crime                     | Severity                             | Detection                               |
| ------------------------- | ------------------------------------ | --------------------------------------- |
| Theft                     | Misdemeanor/Felony (based on value)  | Witness, camera, victim report          |
| Assault                   | Misdemeanor/Felony (based on injury) | Witness, victim report, hospital report |
| Murder                    | Felony                               | Investigation required                  |
| Breaking & Entering       | Felony                               | Alarm, witness, evidence left behind    |
| Drug possession           | Misdemeanor/Felony (based on amount) | Search, witness                         |
| Drug dealing              | Felony                               | Investigation, informant                |
| Fraud                     | Felony                               | Audit, victim report                    |
| Bribery                   | Felony                               | Investigation, witness                  |
| Resisting arrest          | Misdemeanor                          | Automatic if fleeing                    |
| Illegal weapon possession | Misdemeanor/Felony                   | Search                                  |
| Vandalism                 | Misdemeanor                          | Witness, camera                         |
| Stolen vehicle            | Felony                               | Registration check, report              |

### 9.2 Heat System

Heat is per-character, per-faction, not global. A character can be:

- Unknown to police
- Person of interest (investigation opened)
- Wanted for questioning
- Warrant issued
- Active manhunt

Heat decays slowly over time if no new crimes committed. Heat transfers to known aliases but not to unknown ones.

### 9.3 Arrest → Jail → Trial

```
1. Police NPC (or player cop) attempts arrest
2. If successful: character transported to jail
3. Booking: inventory confiscated, phone call allowed
4. Bail: set based on crime severity and flight risk
   - Pay bail → released pending trial
   - Can't pay → stay in jail
5. Trial: scheduled (real hours/days later)
   - Lawyer NPC or player lawyer can affect outcome
   - Evidence quality matters (information_assets with high confidence, well-sourced)
   - Outcome: acquitted, convicted (fine), convicted (jail time), convicted (prison)
6. Prison: restricted actions (limited communication, no items, limited movement)
   - Can still: talk to visitors, make calls, give orders to associates, plan escape
```

### 9.4 Death

When a character dies:

- **Lose:** carried items, equipped items, cash on person. Whatever was on you at time of death.
- **Keep:** bank accounts, owned property/deeds, vehicles (not the one you crashed), items stored in residence, faction standing, skills/XP.
- Successor character inherits everything kept. No penalty beyond what was on your body.
- Death is expected to be frequent. The cost is what you had on you — plan accordingly. Stash valuables.

---

## 10. Faction System

### 10.1 Faction Types

| Type            | Examples                                                          |
| --------------- | ----------------------------------------------------------------- |
| Law enforcement | Calder City PD, State Police, FBI, DEA, Coast Guard               |
| Organized crime | Calder crime families, smuggling rings, drug cartels              |
| Street gangs    | Foundry Ward Kings, Waterfront Reapers, Ironbridge Union          |
| Corporations    | Calder Industries, Harbor Shipping Co., Midtown Development Group |
| Institutions    | City Hall, Courthouse, Hospital Administration, University        |
| Media           | Calder Tribune, Channel 7 News, Pirate radio stations             |
| Underground     | Hacker collective, vigilante network, occult society              |

### 10.2 Faction State

Each faction has:

- Members (characters with roles)
- Assets (money, property, vehicles, equipment)
- Territory (districts/neighborhoods they control)
- Goals (current objectives, e.g., "expand into Foundry Ward", "arrest the Ironbridge Union leader")
- Relationships with other factions (-100 to +100: allied, friendly, neutral, suspicious, hostile, at war)
- Heat with law enforcement
- Resources (money, weapons stockpile, influence)

### 10.3 Player-Faction Relationship

Players interact with factions through:

- Joining (membership application, initiation)
- Working for (jobs, missions, contracts)
- Opposing (crimes against faction members/property)
- Trading (selling goods, information)
- Influencing (bribery, blackmail, persuasion)

---

## 11. Information Warfare

### 11.1 The Four Layers (from FOUNDATION.md)

```
1. Objective truth    → what actually happened (event_ledger)
2. Recorded state     → what systems captured (information_assets with truth_status="observation")
3. Believed state     → what characters think (information_assets with holder=character_id)
4. Public narrative   → what the city broadly accepts (information_assets with public visibility)
```

Players fight across all four:

- Destroy evidence → changes layer 2, not layer 1
- Plant evidence → creates false layer 2, may propagate to layers 3 and 4
- Lie convincingly → creates false belief (layer 3) in the listener
- Start a rumor → shifts layer 4, may pressure institutions to act
- Kill a witness → removes a layer 3 holder, but layer 2 may still exist
- Bribe a clerk → alters layer 2 before it propagates

### 11.2 Information Quality

Every information_asset has:

- `truth_status`: observation, inference, rumor, planted, forged, mistaken
- `confidence`: 0.0-1.0
- `source_event_id`: which event produced this information
- `holder_instance_id`: who knows this

---

## 12. Action System — Full Freeform

### 12.1 Action Envelope (already designed in FOUNDATION.md, extend for full scope)

```yaml
action:
  actor: character_id
  intent: freeform_description # "I want to..."
  target: entity_id | location_id | character_id | null
  method: how (items used, skills applied, approach)
  timing: now | scheduled_timestamp
  duration: estimated_seconds | null # null = instant resolution
  concealment: what the actor is hiding
  conditions: ["if X happens, abort", "only if the door is unlocked"]
  resources_expended: [{ item_id, quantity }]
  risks_accepted: ["may be seen", "may leave evidence"]
```

### 12.2 Resolution Pipeline (same as FOUNDATION.md, now fully specified)

```
1. PARSE: AI converts freeform to structured action envelope
2. GROUND: Resolve every reference against stored state
3. VALIDATE: Check prerequisites (skills, items, location, access, timing)
4. RESERVE: Lock resources (prevent double-spend, simultaneous use)
5. SCHEDULE: If duration > 0, schedule resolution at resolves_at
6. RESOLVE: Apply rules engine (contest resolution, probability checks)
7. COMMIT: Write events to ledger (atomic)
8. DISTRIBUTE: Create information_assets for observers
9. NARRATE: AI renders perspective-correct response
```

### 12.3 Action Types (full catalog)

```
- move         (travel to location)
- use          (activate item/device)
- attack       (combat action)
- steal        (take item from location/character)
- search       (investigate location/item/character)
- talk         (initiate conversation with NPC/player)
- craft        (build/create item)
- drive        (operate vehicle)
- hack         (bypass electronic security)
- lockpick     (bypass physical lock)
- hide         (conceal self or item)
- sneak        (move stealthily)
- bribe        (offer money for service/information)
- threaten     (intimidate)
- persuade     (convince through argument)
- interrogate  (question under pressure)
- heal         (treat injury)
- arrest       (law enforcement action)
- detain       (citizen's restraint)
- buy/sell     (economic transaction)
- call/message (communication)
- observe      (watch location/person, gain information over time)
- plant        (place bug, evidence, bomb, tracker)
- disguise     (change appearance)
- forge        (create fake document/ID)
```

Each action type has a resolution function in the rules engine. Many reuse the same `resolveContest()` function with different `DerivedContest` inputs (like detection already works — extend pattern).

---

## 13. Combat System

### 13.1 Design Philosophy

Combat is not a separate minigame. It's the same action system with higher stakes and faster resolution. No "combat mode" — a fight can start and end at any time, and players can flee, call for help, or escalate during it.

### 13.2 Combat Resolution

Each combat action is a contest:

```
actor: attacker_skills + weapon_effectiveness + surprise_bonus + positioning
target: defender_skills + armor + cover + awareness
```

Resolution produces:

- Hit/miss
- Damage (to character condition or specific body part)
- Injuries (persistent effects: "bleeding", "broken_arm", "concussed")
- Position changes (knocked down, disarmed, pushed back)
- Noise (attracts attention from nearby NPCs/players)

### 13.3 Lethality

Based on weapon and targeting:

- Fists: bruising, possible KO, rarely lethal
- Knife: bleeding, lethal if untreated
- Gun: high lethality, location-dependent (leg = disabling, chest = critical)
- Vehicle: ramming causes damage to both

Death is real. Medical attention can prevent it if reached in time.

---

## 14. What Already Works (Don't Break)

The existing codebase is solid for:

| System             | Status   | What to keep                                                                                                                                                                                               |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database schema    | ✅ Built | entity_definitions/revisions/instances, event_ledger, player_characters, residence_occupancies, information_assets, generated_content_requests, action_intents, resolution_results, conversations, ai_runs |
| Content system     | ✅ Built | GeneratedDefinitionDraft, effects, modes, requirements, costs, signatures, acquisition paths                                                                                                               |
| Rules engine       | ✅ Built | Deterministic contest resolution, probability checks, score derivation, detection operations                                                                                                               |
| Contracts          | ✅ Built | Zod validation for all existing types                                                                                                                                                                      |
| Invention pipeline | ✅ Built | createRequest → normalize → validate → install                                                                                                                                                             |
| Starter world      | ✅ Built | Calder City → Foundry Ward → Ashdown Apartments → Alley                                                                                                                                                    |
| Action service     | ✅ Built | Parse → contest → commit → narrate loop                                                                                                                                                                    |
| API                | ✅ Built | Hono routes for conversations, actions, characters, world                                                                                                                                                  |
| Worker             | ⚠️ Stub  | apps/worker/src/index.ts exists, needs scheduling logic                                                                                                                                                    |

---

## 15. What Needs to Be Built

### Phase A — Core Systems (These all depend on each other conceptually)

| System                   | What to build                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Character skills**     | Skill table, skill check function in rules-engine, XP gain on action, skill gating for invention                |
| **Real-time scheduling** | Worker process that checks `resolves_at` timestamps, resolves due actions, triggers NPC schedules               |
| **Item creation gating** | Extend invention pipeline with skill checks, material requirements, build timers                                |
| **Location expansion**   | Seed all 11 districts with locations and travel edges                                                           |
| **Movement system**      | Move action type, travel time calculation, location graph traversal                                             |
| **NPC store system**     | Seed all stores (50+) as entity definitions with business_type and inventory_categories, simple buy/sell action |
| **Vehicle system**       | Vehicle entity type, ownership, parking, driving action, travel time modifier                                   |
| **Combat system**        | Combat action types, damage calculation, injury system, death handling                                          |
| **Communication system** | Call/message actions, interception checks, device tracking                                                      |
| **Legal/heat system**    | Crime detection, warrant system, arrest flow, jail, trial                                                       |
| **Faction system**       | Faction definitions, membership, relationships, NPC goal scheduling                                             |
| **Economy**              | Currency tracking, employment income, periodic expenses, bank accounts                                          |

### Phase B — AI Integration

| System                         | What to build                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| **Action parsing**             | Extend AI parsing from detect-only to all action types                              |
| **NPC dialogue**               | NPC AI invocation with constraint packets (knowledge, goals, motives, relationship) |
| **Item difficulty assessment** | AI assigns creationDifficulty, requiredSkills, requiredMaterials from concept       |
| **Narration**                  | Already built — extend for all action types                                         |
| **Investigation narration**    | AI assembles clues into coherent picture without revealing hidden facts             |

### Phase C — Multiplayer

| System                 | What to build                                                              |
| ---------------------- | -------------------------------------------------------------------------- |
| **Player interaction** | Players can see each other in same location, interact (talk, trade, fight) |
| **PvP resolution**     | Same combat system, both sides are players                                 |
| **Information PvP**    | Players can intercept, spy on, and deceive other players                   |

---

## 16. Confirmed Design Decisions

1. **Time scale:** 1:1 — real time equals game time. Stores open/close on real schedules. Day/night matches real world.
2. **Starting skills:** Everyone at 0. No backgrounds. Earn everything through play.
3. **Skill progression:** Quadratic XP curve. N² × 10 XP to reach level N. Competent (50) in ~70 hours, world-class (100) in ~12 days per skill. Nothing impossible — just impractical time costs.
4. **Death penalty:** Lose carried items, equipped items, cash on person. Everything else (bank, property, vehicles, skills, faction standing) persists. Successor inherits all. Death is frequent and shouldn't hammer players.
5. **Player communication:** DM/chat with game only. No player-to-player chat for now.
6. **Player economy:** eBay-style marketplace listings. Seller sets price. Buyer purchases. In-person deals later.
7. **World seeding:** Database migrations. No admin UI needed. Run migration → world populates.
