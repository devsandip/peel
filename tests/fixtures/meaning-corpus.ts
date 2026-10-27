// Fixed synthetic evaluation, authored before model inference. Not dogfood/private notes.
export interface MeaningFixtureNote {
  noteId: string;
  body: string;
  state: "active" | "archived" | "trashed";
  tags: string[];
}
const examples = [
  [
    "picnic",
    "Sunday park bag: pack a blanket, hummus, pita, sliced pears, a water bottle and reusable plates for our outdoor lunch.",
    "What was I planning to take to eat outside?",
  ],
  [
    "passport",
    "Passport renewal errands: find the old booklet, take fresh identity photographs and put the appointment confirmation in the blue folder.",
    "Where is my list for replacing my travel document?",
  ],
  [
    "printer",
    "The office printer stopped joining the wireless network after the router changed. Reconnect it using the printer settings, then print a test page.",
    "What did I write about the printer losing its internet connection?",
  ],
  [
    "garden",
    "While away this weekend, ask a neighbor to water the rooftop tomato pots and move the basil into afternoon shade.",
    "Who should look after the vegetables while I am gone?",
  ],
  [
    "keyboard",
    "The space bar on the spare keyboard sticks. Clean dust beneath the keycap and check the stabilizer before ordering a replacement keyboard.",
    "What was the idea for fixing the key that keeps getting stuck?",
  ],
  [
    "novel",
    "Book club suggestion: The Lantern Orchard, an invented mystery about a gardener finding letters in a greenhouse. Bring it up at the next reading circle.",
    "Which mystery did I want to suggest to the reading group?",
  ],
  [
    "prototype",
    "Prototype review: show the working capture flow first, then explain autosave and error recovery. Keep the demo under five minutes and send a recording afterward.",
    "How did I want to structure the short product demonstration?",
  ],
  [
    "window",
    "Floating memo design: the green minus stores the latest text and puts the window away. The memo stays in the library and can be opened again.",
    "What does the green control do to a memo?",
  ],
  [
    "mountain",
    "Mountain weekend packing: rain shell, trail shoes, wool socks, a headlamp and a dry bag. Leave room for snacks in the small rucksack.",
    "Find my list of gear for the wet hiking trip.",
  ],
  [
    "biscuits",
    "Biscuit experiment: orange zest with dark chocolate pieces. Rest the dough overnight and compare a small test batch with the previous recipe.",
    "Which flavor combination did I want to try in the cookies?",
  ],
  [
    "dog",
    "Practice coming when called with the fictional dog Pippin in a quiet fenced garden. Use tiny rewards and very short sessions before trying a busier place.",
    "Where was I going to practice teaching the dog to return?",
  ],
  [
    "gift",
    "Birthday gift shortlist: a handmade pottery mug, a little fern and a card with a drawing. Check the local craft market on Saturday.",
    "What were my present ideas from the artisan market?",
  ],
  [
    "microphone",
    "Before the video call, choose the headset microphone rather than the laptop input. Record ten seconds locally and listen for room echo.",
    "How was I going to check the sound before the online meeting?",
  ],
  [
    "bicycle",
    "Bicycle workshop reminder: ask about the squeaky rear brake and the chain skipping under load. Take the old repair receipt along.",
    "Which problems did I want the bike shop to investigate?",
  ],
  [
    "subscription",
    "Stream Lantern trial reminder: review whether I used it, check the renewal page and decide whether to stop the subscription before the trial ends.",
    "Where is the reminder about the streaming trial renewing?",
  ],
  [
    "drawing",
    "Life drawing class bag: charcoal pencils, a kneaded eraser, clips and the large sketchpad. The teacher will supply the paper easel.",
    "What equipment should I bring to the sketching lesson?",
  ],
  [
    "scans",
    "Document organization: digitize the paper appliance receipts and warranty slips. Name each file with the purchase month and device, then keep a local backup.",
    "How did I want to organize electronic copies of the purchase papers?",
  ],
  [
    "plant",
    "The desk plant has yellow leaves and water collecting in its saucer. Check drainage and the potting mix before moving it to a brighter window.",
    "What was the note about the unhappy plant on my desk?",
  ],
  [
    "filament",
    "Three-dimensional printer troubleshooting: the plastic extrusion is uneven. Inspect the nozzle for a blockage and check whether the filament spool was kept dry.",
    "Where is the checklist for the uneven output from the plastic printer?",
  ],
  [
    "seating",
    "Fictional celebration seating: keep the cousins together at the long table, put the grandparents near the quiet side and leave a clear aisle beside the musicians.",
    "How did I want to arrange relatives at the party?",
  ],
  [
    "roadtrip",
    "Road trip preparation: download maps before leaving, put the phone charging lead in the car and write the overnight stop on the paper itinerary.",
    "What should I prepare so navigation works without reception on the drive?",
  ],
  [
    "parcel",
    "Return parcel tasks: print the merchant's return label, reuse the sturdy cardboard box and take brown tape to the post office.",
    "What did I need to send the unwanted item back?",
  ],
  [
    "camera",
    "Photo walk kit: charge both camera batteries, format an empty memory card and bring the small tripod for evening exposures by the river.",
    "What was I going to carry for taking pictures after sunset?",
  ],
  [
    "retry",
    "Service retry design: use exponential backoff with jitter, cap the attempts and keep a visible retry state. Preserve the local draft when the remote request fails.",
    "What was the plan for dealing with repeated request failures?",
  ],
  [
    "curtains",
    "Curtain project: measure the narrow kitchen window twice and choose washable linen. The larger living room window is a separate project.",
    "Which room were the washable linen curtains intended for?",
  ],
  [
    "guitar",
    "Guitar practice plan: slow down the difficult chorus with a metronome, loop only the chord change and raise the tempo after it feels consistent.",
    "How was I going to practice the awkward part of the song?",
  ],
  [
    "stars",
    "Stargazing outing checklist: leave the city lights behind, take a warm coat and thermos, and use a dim red torch for reading the sky map.",
    "What was the plan for watching the night sky away from town?",
  ],
  [
    "french",
    "French vocabulary practice: put unfamiliar cooking words into spaced repetition cards and use each word in an invented restaurant sentence.",
    "How did I plan to remember the new foreign-language food words?",
  ],
  [
    "festival",
    "Archived festival plan: meet by the sculpture garden, see the afternoon puppet performance and take the shuttle back from the south entrance.",
    "Where was the meeting point in the old festival itinerary?",
  ],
  [
    "kettle",
    "Workshop journal.\n" +
      "Inventory the shelves, sort the spare fasteners and record the paint colors for the cabinet project. ".repeat(
        45,
      ) +
      "\nFinal appliance note: the leaking kettle spout needs a silicone sealing gasket. Put that replacement seal on the parts list.",
    "Which replacement part did I need to stop the kettle leaking?",
  ],
] as const;
export const meaningQuestions = examples.map(([noteId, , query], index) => ({
  caseId: `q${String(index + 1).padStart(2, "0")}`,
  noteId,
  query,
}));
const distractors = [
  "Park maintenance: the council will repair the footbridge and repaint the outdoor benches.",
  "Dinner indoors: reserve a restaurant table and decide whether to order soup or noodles.",
  "Vacation postcards: choose a few landscape photographs to print for the album.",
  "Router shelf: measure the wooden bracket before installing the internet equipment in the hall.",
  "Laser printer supplies: order ordinary paper and recycle the empty toner cartridge.",
  "Garden fence: compare paint swatches and replace the broken gate latch.",
  "Tomato soup idea: roast the vegetables and try adding a little smoked paprika.",
  "Computer desk layout: move the monitor stand and label the charging cables.",
  "Writing prompt: invent a lighthouse keeper who discovers a map in a teapot.",
  "Reading notes: compare the pacing of the final chapters of a fictional space adventure.",
  "Prototype colors: evaluate pale yellow, peach and green with dark text.",
  "Office window: ask for a quote to replace the cracked glass pane.",
  "Walking route: a short flat loop through the neighborhood with a stop at the bakery.",
  "Camping meal plan: decide between lentil stew and rice for the first evening.",
  "Chocolate tasting: buy a small selection of plain dark bars to compare cocoa flavors.",
  "Dog portrait: ask the illustrator about drawing a fictional terrier wearing a scarf.",
  "Pottery class: bring an apron and collect the bowl after it comes out of the kiln.",
  "Housewarming gifts: a wooden chopping board and a tea towel for the new kitchen.",
  "Meeting agenda: reserve time for questions about next month's delivery schedule.",
  "Headphone storage: put spare ear cushions and the carrying pouch in the desk drawer.",
  "Bicycle route map: choose the path along the canal rather than the busy main road.",
  "Music subscription playlist: collect instrumental tracks for background listening.",
  "Painting workshop: compare brush shapes and practice mixing shades of blue.",
  "Receipt envelope: keep the original paper records in the labeled filing box.",
  "Desk lamp: a warmer bulb might make evening reading more comfortable.",
  "Plant drawing: sketch leaf shapes using a soft pencil on textured paper.",
  "Printer sculpture: design a small decorative figurine for a friend's bookshelf.",
  "Wedding photographs: shortlist a few images for an imaginary family album.",
  "Car cleaning: remove the floor mats and put the umbrella in the boot.",
  "Parcel shelves: label the empty storage boxes by their dimensions.",
  "Camera shopping: compare lightweight shoulder straps before buying any accessory.",
  "Software release: write clear notes explaining the visible changes in the next build.",
  "Living room curtains: look at heavy dark fabric for the wide front window.",
  "Guitar repair: ask the instrument workshop about replacing a loose tuning peg.",
  "Astronomy book: borrow an illustrated guide to the planets from the library.",
  "Cooking lesson: practice chopping vegetables and preparing a simple sauce.",
  "Festival packing: a reusable cup and sun hat for the outdoor music stages.",
  "Coffee grinder maintenance: remove stale grounds and clean the collection tray.",
  "Cabinet repair: the door needs a new hinge and a matching brass handle.",
  "Rainy-day museum visit: book an afternoon entry and check where the cloakroom is.",
];
export const meaningNotes: MeaningFixtureNote[] = [
  ...examples.map(([noteId, body]) => ({
    noteId,
    body,
    state: (noteId === "festival" ? "archived" : "active") as
      "active" | "archived",
    tags: ["fixture"],
  })),
  ...distractors.map((body, index) => ({
    noteId: `distractor-${String(index).padStart(2, "0")}`,
    body,
    state: "active" as const,
    tags: ["distractor"],
  })),
  {
    noteId: "deleted-picnic",
    body: "Outdoor lunch picnic packing blanket hummus food in the park.",
    state: "trashed",
    tags: ["fixture"],
  },
];
