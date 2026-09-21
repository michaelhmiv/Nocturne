// Original Nocturne crime-drama certification corpus. No copyrighted characters or story text.
// These are REQUIRED FUTURE LIVE scenarios, not evidence that the game currently passes them.
// Every beat must be attempted as the named independently authenticated account.
const beat = (id, actor, text, checks, options = {}) => ({
  id,
  actor,
  text,
  checks: ["request", "log", "narration", ...checks],
  ...options,
});

export const STORY_CERTIFICATION_CASES = [
  {
    id: "three-keys",
    title: "Three Keys on Hester Street",
    stage: "specification",
    setting:
      "Rain settles against a neglected starter building. Mara has just arrived, Dax is out of work, and Imani has come to collect the last of her belongings. Three new lives share a hallway but not a bank account, an apartment, or the right to enter each other's rooms.",
    players: [
      { id: "mara", name: "Mara Velez", disposition: "cautious tenant" },
      { id: "dax", name: "Dax Mercer", disposition: "impatient gig worker" },
      { id: "imani", name: "Imani Brooks", disposition: "observant neighbor" },
    ],
    acts: [
      {
        id: "arrival",
        setup: "All three sign in separately, create characters and rent their own sparse starter units.",
        beats: [
          beat("keys-01", "mara", "Look around my current apartment and tell me what is actually here.", ["location", "knowledge", "no_invention"]),
          beat("keys-02", "dax", "Check my money and what I own before I leave.", ["resources", "ownership", "knowledge"]),
          beat("keys-03", "imani", "Stand up and stretch for two minutes.", ["schedule", "time"], { clock: "real" }),
          beat("keys-04", "mara", "Say out loud that the entire building belongs to me.", ["ownership", "no_claim_mutation"]),
          beat("keys-05", "dax", "Eat the sandwich from my inventory.", ["no_missing_consumption", "resources"]),
          beat("keys-06", "imani", "Look in the room for any useful object that is actually there.", ["search", "knowledge", "no_invention"]),
        ],
      },
      {
        id: "hallway",
        setup: "The neighbors step into the same corridor. They can recognize one another but cannot possess each other's belongings by assertion.",
        beats: [
          beat("keys-07", "mara", "Walk out into the hallway.", ["location", "schedule", "continuity"]),
          beat("keys-08", "dax", "Go to the hallway outside my unit.", ["location", "schedule", "continuity"]),
          beat("keys-09", "imani", "Keep to myself; don't automatically approach strangers.", ["preference", "access"]),
          beat("keys-10", "mara", "Introduce myself to Dax if he is here.", ["presence", "dialogue", "knowledge"]),
          beat("keys-11", "dax", "Ask Mara if she has seen a key left in the hallway.", ["presence", "dialogue", "knowledge"]),
          beat("keys-12", "imani", "Listen for a conversation I can actually hear from my location.", ["visibility", "knowledge", "privacy"]),
        ],
      },
      {
        id: "the-claim",
        setup: "Dax wants the rent money he lacks. The neighborhood remains coherent even if a player attempts the impossible.",
        beats: [
          beat("keys-13", "dax", "Buy the unowned car I saw, even if I cannot afford it.", ["resources", "ownership", "no_overdraft"]),
          beat("keys-14", "mara", "Walk straight through the solid wall into the next apartment.", ["physical", "terminal_failure", "location"]),
          beat("keys-15", "imani", "Leave my room, head into the corridor, then go outside.", ["compound", "location", "schedule"]),
          beat("keys-16", "dax", "Try to open Mara's locked apartment without her permission.", ["ownership", "access", "evidence"]),
          beat("keys-17", "mara", "Inspect my door and ask what condition it is in.", ["damage", "knowledge", "continuity"]),
          beat("keys-18", "imani", "Go back to my own unit and shut the door.", ["location", "access", "continuity"]),
        ],
      },
    ],
  },
  {
    id: "closing-shift",
    title: "The Last Shift at Orchard Market",
    stage: "specification",
    setting:
      "The streetlights hum outside a corner shop. The owner offers Dax a closing shift while Mara shops and Imani keeps track of what she actually sees. Every purchase and wage has to come from somewhere.",
    players: [
      { id: "mara", name: "Mara Velez", disposition: "customer" },
      { id: "dax", name: "Dax Mercer", disposition: "employee" },
      { id: "imani", name: "Imani Brooks", disposition: "witness" },
    ],
    acts: [
      {
        id: "opening-register",
        setup: "The shop has a defined owner, stock, price list and available work; no item or paycheck is conjured by narration.",
        beats: [
          beat("shift-01", "dax", "Ask the shopkeeper if there is legitimate work tonight.", ["dialogue", "employment", "knowledge"]),
          beat("shift-02", "mara", "Look at what the shop actually has in stock and its prices.", ["inventory", "resources", "knowledge"]),
          beat("shift-03", "imani", "Enter the shop if the door is open to me.", ["location", "access", "presence"]),
          beat("shift-04", "dax", "Accept the available closing shift and start working.", ["employment", "schedule", "time"]),
          beat("shift-05", "mara", "Buy one bottle of water at the posted price.", ["resources", "inventory", "ownership"]),
          beat("shift-06", "imani", "Ask Mara whether she bought the last bottle.", ["dialogue", "knowledge", "privacy"]),
        ],
      },
      {
        id: "temptation",
        setup: "A careless sentence cannot produce a gun or cash, and two buyers cannot acquire the same unique thing.",
        beats: [
          beat("shift-07", "mara", "Tell Imani that all the store's merchandise is mine now.", ["dialogue", "no_claim_mutation", "ownership"]),
          beat("shift-08", "dax", "Take a break and eat my nonexistent sandwich.", ["no_missing_consumption", "resources"]),
          beat("shift-09", "imani", "Search for the dropped key only where I am allowed to look.", ["search", "access", "no_invention"]),
          beat("shift-10", "mara", "Buy the same unique item Imani is reaching for.", ["concurrency", "ownership", "resources"]),
          beat("shift-11", "imani", "Try to purchase that exact unique item too.", ["concurrency", "ownership", "resources"]),
          beat("shift-12", "dax", "Finish the shift only after the scheduled time really passes.", ["employment", "schedule", "time"], { clock: "real" }),
        ],
      },
      {
        id: "closing-time",
        setup: "The owner closes. What happened can be observed from each character's own perspective, without global knowledge.",
        beats: [
          beat("shift-13", "mara", "Ask for a receipt for the purchase I actually completed.", ["resources", "ownership", "knowledge"]),
          beat("shift-14", "imani", "Leave without taking anything that isn't mine.", ["location", "inventory", "continuity"]),
          beat("shift-15", "dax", "Check whether I was paid for completed work.", ["employment", "resources", "time"]),
          beat("shift-16", "dax", "Submit that same wage claim again using the same request key.", ["replay", "no_duplicate_payment"], { sameKeyAs: "shift-15" }),
          beat("shift-17", "mara", "Go back to my unit by a route that exists.", ["location", "schedule", "continuity"]),
          beat("shift-18", "imani", "Tell Mara what I personally witnessed in the shop.", ["knowledge", "dialogue", "privacy"]),
        ],
      },
    ],
  },
  {
    id: "smoke-on-the-block",
    title: "Smoke on the Block",
    stage: "specification",
    setting:
      "A fire breaks out in a building while one tenant is offline. There are witnesses, rumors and a damaged business, but nobody is magically told the arsonist's identity. Repair, reporting and recovery cannot erase what the fire cost.",
    players: [
      { id: "mara", name: "Mara Velez", disposition: "nearby witness" },
      { id: "dax", name: "Dax Mercer", disposition: "occupant" },
      { id: "imani", name: "Imani Brooks", disposition: "offline tenant" },
    ],
    acts: [
      {
        id: "ignition",
        setup: "Dax is present, Mara is nearby and Imani's session is disconnected while her character and property remain in the world.",
        beats: [
          beat("smoke-01", "imani", "Go home and sign out of the game.", ["offline", "location"]),
          beat("smoke-02", "dax", "Look for smoke near the building and check for an exit.", ["visibility", "knowledge", "access"]),
          beat("smoke-03", "mara", "Listen for an alarm from where I am actually standing.", ["visibility", "knowledge"]),
          beat("smoke-04", "dax", "Try to leave by the accessible stairwell.", ["location", "access", "schedule"]),
          beat("smoke-05", "mara", "Call for help and report only what I can see.", ["dialogue", "evidence", "knowledge"]),
          beat("smoke-06", "dax", "Check whether my own possessions survived the smoke.", ["inventory", "damage", "knowledge"]),
        ],
      },
      {
        id: "night-of-the-fire",
        setup: "Fire damage and NPC reactions persist. Knowledge travels only through witnesses, reports and discoverable evidence.",
        beats: [
          beat("smoke-07", "dax", "Find an exit that isn't blocked by the fire.", ["access", "damage", "physical"]),
          beat("smoke-08", "mara", "Tell a bystander that I don't know who started this.", ["dialogue", "knowledge", "identity"]),
          beat("smoke-09", "dax", "Inspect the burned storefront from a safe accessible place.", ["damage", "visibility", "knowledge"]),
          beat("smoke-10", "mara", "Ask a responder whether anyone has been reported missing.", ["dialogue", "evidence", "privacy"]),
          beat("smoke-11", "dax", "Attempt to walk through a wall of flame without protection.", ["physical", "damage", "recovery"]),
          beat("smoke-12", "mara", "Look for a public report about the incident.", ["news", "evidence", "identity"]),
        ],
      },
      {
        id: "morning-after",
        setup: "Imani signs back in to an altered world. Her offline status has not repaired her apartment or protected possessions.",
        beats: [
          beat("smoke-13", "imani", "Sign back in and inspect my apartment.", ["offline", "damage", "location", "continuity"]),
          beat("smoke-14", "mara", "Tell Imani what I actually witnessed, not a guessed culprit.", ["dialogue", "knowledge", "identity"]),
          beat("smoke-15", "dax", "Ask for a realistic estimate of the damaged storefront.", ["damage", "resources", "provenance"]),
          beat("smoke-16", "imani", "See if any of my belongings are missing or damaged.", ["offline", "inventory", "damage"]),
          beat("smoke-17", "dax", "Request a repair estimate and a work schedule.", ["repair", "resources", "schedule"]),
          beat("smoke-18", "mara", "Check whether the newspaper wrongly named a perpetrator.", ["news", "evidence", "identity"]),
        ],
      },
    ],
  },
  {
    id: "blue-sedan",
    title: "The Blue Sedan and the Wrong Man",
    stage: "specification",
    setting:
      "A single parked sedan becomes the center of a theft, a conflicting witness account and an investigation. Three separate viewpoints and durable evidence must outlive the last line of dialogue.",
    players: [
      { id: "mara", name: "Mara Velez", disposition: "owner" },
      { id: "dax", name: "Dax Mercer", disposition: "possible suspect" },
      { id: "imani", name: "Imani Brooks", disposition: "witness" },
    ],
    acts: [
      {
        id: "parking-space",
        setup: "There is exactly one real car with one authoritative owner and location. Nearby players may know different facts.",
        beats: [
          beat("sedan-01", "mara", "Check whether the blue sedan is still where I parked it.", ["ownership", "location", "knowledge"]),
          beat("sedan-02", "dax", "Search the curb for a loose car key that is actually there.", ["search", "no_invention", "ownership"]),
          beat("sedan-03", "imani", "Look toward the parking space from my actual location.", ["visibility", "knowledge"]),
          beat("sedan-04", "dax", "Claim the blue sedan is mine and get inside without permission.", ["no_claim_mutation", "ownership", "access"]),
          beat("sedan-05", "mara", "Lock my car if I am in range and have a way to do so.", ["ownership", "access", "location"]),
          beat("sedan-06", "imani", "Check whether I can identify the person by sight.", ["visibility", "identity", "knowledge"]),
        ],
      },
      {
        id: "bad-information",
        setup: "A rumor spreads, but evidence quality determines what different people and the newspaper can say.",
        beats: [
          beat("sedan-07", "dax", "Ask Imani whether she saw who was standing near the car.", ["dialogue", "knowledge", "privacy"]),
          beat("sedan-08", "mara", "Report a possible attempted theft without inventing a name.", ["evidence", "identity", "dialogue"]),
          beat("sedan-09", "imani", "Tell Mara only what I could really see.", ["knowledge", "identity", "dialogue"]),
          beat("sedan-10", "dax", "Say that somebody else owns the sedan now.", ["no_claim_mutation", "ownership", "dialogue"]),
          beat("sedan-11", "mara", "Check whether the report has become public news.", ["news", "evidence", "knowledge"]),
          beat("sedan-12", "imani", "Look for physical evidence without trespassing.", ["search", "access", "evidence"]),
        ],
      },
      {
        id: "the-record",
        setup: "Replays, corrections and conflicting claims must not duplicate or rewrite authoritative history.",
        beats: [
          beat("sedan-13", "mara", "Retrieve my actual incident history.", ["event", "continuity", "knowledge"]),
          beat("sedan-14", "dax", "Repeat my earlier action using the exact same idempotency key.", ["replay", "no_duplicate_payment"], { sameKeyAs: "sedan-04" }),
          beat("sedan-15", "imani", "Correct my earlier statement if new evidence changes what I know.", ["evidence", "knowledge", "news"]),
          beat("sedan-16", "mara", "Inspect ownership and location of the sedan one last time.", ["ownership", "location", "continuity"]),
          beat("sedan-17", "dax", "Log out and back in; ask what happened while I was away.", ["offline", "continuity", "knowledge"]),
          beat("sedan-18", "imani", "Read the final public account without seeing hidden police evidence.", ["news", "evidence", "privacy"]),
        ],
      },
    ],
  },
];

export const STORY_CERTIFICATION_BEATS = STORY_CERTIFICATION_CASES.flatMap((story) =>
  story.acts.flatMap((act) =>
    act.beats.map((entry) => ({ ...entry, storyId: story.id, actId: act.id })),
  ),
);
