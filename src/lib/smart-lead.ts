// Smart leads: a cheat sheet for every engine lead, so a rep walks into the call already talking
// the owner's language. Who this kind of business is, how its money moves, what is going on in its
// world this time of year, how it would use working capital right now, the words it uses, what it
// will push back with, and an opener built from all of that plus the lead's own records.
//
// Written playbooks, not a model: the same lead always gets the same sheet, nothing is made up
// about the business, and it costs nothing to show. No imports, so the Deno tests load it as is.
//
// Rep-facing copy. Never the word "loan": an MCA is a purchase of future receivables. Never promise
// approval, amounts or rates.

export type Season = "winter" | "spring" | "summer" | "fall";
export type SeasonNote = { now: string; use: string };
export type Pushback = { they: string; you: string };

export type Playbook = {
  key: string;
  /** "a home improvement contractor": reads in a sentence */
  label: string;
  /** "contractors": for the opener */
  plural: string;
  /** who they are and how money moves through the business */
  who: string;
  /** what working capital does for them, any time of year */
  uses: string[];
  /** words and ideas that make the rep sound like they know the trade */
  language: string[];
  pushback: Pushback[];
  seasons: Record<Season, SeasonNote>;
  /** winter where it barely snows (the South and West): replaces seasons.winter there */
  warmWinter?: SeasonNote;
};

const CONTRACTOR: Playbook = {
  key: "contractor",
  label: "a contractor",
  plural: "contractors",
  who: "An owner-operator or small crew doing renovations, repairs or new work. They buy materials and pay crews before the customer pays, often in stages (deposit, progress payments, final), so cash is always tied up in jobs that aren't finished.",
  uses: [
    "Materials for the next job before the deposit clears",
    "Making payroll for the crew while waiting on a progress payment",
    "Taking on a bigger job they'd otherwise have to turn down",
    "Equipment or a second truck so two jobs can run at once",
  ],
  language: [
    "draws and progress payments",
    "retainage (the part held back until the job is signed off)",
    "carrying the job",
    "materials up front",
    "the backlog: jobs signed but not started",
  ],
  pushback: [
    {
      they: "I get paid when the job's done, I'm fine.",
      you: "Makes sense. What happens when two jobs need materials the same week? That gap is what this covers, and it's paid back out of the deposits coming in.",
    },
    {
      they: "I don't want to owe anybody.",
      you: "It's an advance against money your customers already owe you, paid back as those payments come in, not a fixed bill every month.",
    },
  ],
  seasons: {
    winter: {
      now: "Outdoor work slows hard in the cold months and many crews sit idle until March, while bills and payroll for the people they want to keep don't stop.",
      use: "Carry the crew through the slow months, or buy materials now at off-season prices for the spring backlog.",
    },
    spring: {
      now: "The busy season is starting: homeowners sign the projects they planned all winter, and everyone needs materials and crews at once.",
      use: "Front-load materials and hire for the spring rush so they can say yes to every signed job.",
    },
    summer: {
      now: "Peak season. Crews are stretched across several jobs and progress payments lag behind the work.",
      use: "Cover the gap between the work done and the draws coming in, so they can keep taking jobs.",
    },
    fall: {
      now: "The race to close out exterior jobs before the cold, and to get paid before the holidays slow everything down.",
      use: "Finish this season's jobs strong and carry the crew into a slow winter.",
    },
  },
  warmWinter: {
    now: "Winter is a working season where it doesn't freeze, and snowbird and holiday-break projects keep the schedule full.",
    use: "Materials and payroll for the winter jobs while customers pay on completion.",
  },
};

const TRUCKING: Playbook = {
  key: "trucking",
  label: "a trucking company",
  plural: "trucking companies",
  who: "A carrier with its own trucks hauling for brokers and shippers. Fuel, insurance, repairs and weekly driver pay go out every week, while brokers and shippers usually pay in 30 to 60 days.",
  uses: [
    "Fuel and driver pay while invoices sit unpaid for 30 to 60 days",
    "A repair or new tires that would otherwise park a truck",
    "Insurance down payments and renewals",
    "A deposit on another truck to take more loads",
  ],
  language: [
    "loads and lanes",
    "broker pay terms (net 30, net 45)",
    "factoring (selling invoices to get paid sooner)",
    "deadhead miles (driving empty)",
    "a truck down = no revenue",
  ],
  pushback: [
    {
      they: "I already factor my invoices.",
      you: "Lots of carriers do. Factoring covers the invoices; this covers everything else, like a repair or an insurance payment, without touching your factoring.",
    },
    {
      they: "Rates are bad right now, I can't take on more.",
      you: "That's exactly when one breakdown hurts most. Having cash for repairs keeps every truck earning.",
    },
  ],
  seasons: {
    winter: {
      now: "After the holiday rush, freight slows in January and February, and winter is hard on equipment: tires, batteries, breakdowns.",
      use: "Keep the trucks running and the drivers paid through the slow freight months.",
    },
    spring: {
      now: "Freight picks up with produce season and construction materials, and spring is when many carriers renew insurance and plates.",
      use: "Insurance and registration costs, and catching up on maintenance put off over winter.",
    },
    summer: {
      now: "Produce and construction freight keep lanes busy, and the heat is hard on tires and cooling systems.",
      use: "Repairs and fuel while carrying more loads on 30 to 60 day pay.",
    },
    fall: {
      now: "Peak season: retail restocking for the holidays and harvest freight. Lots of loads, but the more they haul, the more cash sits in unpaid invoices.",
      use: "Fuel and driver pay so they can take every peak-season load, plus winter prep for the trucks.",
    },
  },
};

const AUTO_REPAIR: Playbook = {
  key: "auto_repair",
  label: "an auto repair shop",
  plural: "auto shops",
  who: "A licensed repair or inspection shop with bays, lifts and techs to keep busy. Parts are bought up front, insurance and fleet customers can pay slowly, and one equipment purchase can eat a month's cash.",
  uses: [
    "New equipment: a lift, an alignment rack, diagnostic tools for newer cars",
    "Parts inventory so cars don't sit waiting on orders",
    "Covering payroll while insurance jobs are paid",
    "Hiring another tech to open an empty bay",
  ],
  language: [
    "bays and car count",
    "parts on hand vs. special order",
    "insurance work and waiting on adjusters",
    "diagnostic equipment for newer vehicles",
    "techs are hard to find",
  ],
  pushback: [
    {
      they: "Business is steady, I don't need anything.",
      you: "Good to hear. If you could add one thing that brings in more cars, a lift or a tech, what would it be?",
    },
    {
      they: "I'll just put it on a credit card.",
      you: "A card works for small things. For a lift or a hire, this is paid back from the jobs it brings in, not on a fixed monthly bill.",
    },
  ],
  seasons: {
    winter: {
      now: "Cold weather brings batteries, tires, heaters and pothole damage, but holiday spending can leave customers slow to approve big repairs.",
      use: "Stock winter parts and keep techs paid while customers put off bigger jobs.",
    },
    spring: {
      now: "Tax refund season: customers finally approve the repairs they put off all winter, and inspections and tire changeovers pick up.",
      use: "Parts and a tech to handle the spring rush of approved repairs.",
    },
    summer: {
      now: "Road trip season: AC, cooling systems, tires and brakes before travel.",
      use: "Inventory and equipment for the busy summer car count.",
    },
    fall: {
      now: "Winter prep: tires, batteries and heating checks, and a good time to add equipment before the cold-weather rush.",
      use: "Winter parts inventory and equipment upgrades before the busy months.",
    },
  },
  warmWinter: {
    now: "Mild winters keep cars on the road, and snowbirds and holiday travel bring in extra work.",
    use: "Parts and techs to keep up with steady winter work.",
  },
};

const USED_CARS: Playbook = {
  key: "used_cars",
  label: "a used car dealer",
  plural: "used car dealers",
  who: "A dealer buying cars at auction or on trade, reconditioning them and selling off the lot. Every car on the lot is cash sitting still until it sells.",
  uses: [
    "Buying more inventory at auction while prices are right",
    "Reconditioning: getting cars front-line ready faster",
    "Covering floor plan payments when sales slow",
  ],
  language: [
    "inventory turn: how fast cars sell",
    "auction buys",
    "recon (getting a car ready to sell)",
    "floor plan",
    "front-line ready",
  ],
  pushback: [
    {
      they: "I already have a floor plan.",
      you: "This doesn't replace it. It covers what the floor plan won't: recon, a good auction buy, or a slow month.",
    },
  ],
  seasons: {
    winter: {
      now: "December and January are slow on the lot, then tax refund season in February brings buyers back in force.",
      use: "Stock up before tax season so the lot is full when refund buyers show up.",
    },
    spring: {
      now: "Tax refund season is the busiest stretch of the year for used cars.",
      use: "Keep inventory turning: buy more at auction as cars sell.",
    },
    summer: {
      now: "Steady sales and family car buying before school starts.",
      use: "Inventory and recon to keep the lot full.",
    },
    fall: {
      now: "Sales slow into the holidays, so it's a chance to buy inventory at auction while others hold back.",
      use: "Buy well now for the tax season rush in February.",
    },
  },
};

const TOWING: Playbook = {
  key: "towing",
  label: "a towing company",
  plural: "towing companies",
  who: "Operators with tow trucks and flatbeds running police rotation, motor club and private calls. Trucks are expensive, motor clubs and insurers pay on their own schedule, and a truck down means calls go to a competitor.",
  uses: [
    "Repairs or a new truck so no calls are missed",
    "Fuel and driver pay while motor club and insurance payments come in",
    "Storage yard costs",
  ],
  language: [
    "rotation lists",
    "motor club calls",
    "flatbeds and wreckers",
    "impound and storage fees",
    "response time",
  ],
  pushback: [
    {
      they: "It's feast or famine, I can't commit to payments.",
      you: "That's why this is paid back as a share of what comes in. Busy weeks pay more, slow weeks less.",
    },
  ],
  seasons: {
    winter: {
      now: "Storms and ice mean the busiest calls of the year, and the hardest weather on the trucks.",
      use: "Keep every truck on the road and drivers paid through storm season.",
    },
    spring: {
      now: "Calls ease off after winter, which is the time to fix what winter broke.",
      use: "Repairs and maintenance after a hard winter.",
    },
    summer: {
      now: "Heat breakdowns and road trip traffic keep calls steady.",
      use: "Fuel, repairs and maybe another truck for the summer volume.",
    },
    fall: {
      now: "Getting the fleet ready before the winter storm season.",
      use: "Repairs, tires and maybe another truck before the storms hit.",
    },
  },
  warmWinter: {
    now: "Holiday and snowbird traffic keeps winter calls steady where there's no ice.",
    use: "Fuel and repairs to keep up with winter traffic.",
  },
};

const RESTAURANT: Playbook = {
  key: "restaurant",
  label: "a restaurant",
  plural: "restaurants",
  who: "An owner-run restaurant living on card sales every day. Food, payroll and rent go out every week, margins are thin, and one broken cooler or a slow month can wipe out the cushion.",
  uses: [
    "Kitchen equipment repair or replacement",
    "Stocking up for a busy season or an event",
    "Payroll through a slow month",
    "A refresh: patio, signage, a new menu",
  ],
  language: [
    "covers (guests served)",
    "food cost and labor cost",
    "catering and private events",
    "slow nights and the weekend rush",
    "card sales every day",
  ],
  pushback: [
    {
      they: "Margins are too thin for this.",
      you: "That's exactly why payments come out as a small share of daily card sales: a slow day takes less, a busy day more.",
    },
    {
      they: "I had a bad experience with one of these.",
      you: "I hear that a lot. What went wrong last time? I'll show you the numbers in dollars up front so there are no surprises.",
    },
  ],
  seasons: {
    winter: {
      now: "After the holiday parties, January and February are the slowest months for most restaurants.",
      use: "Cover payroll and rent through the post-holiday slowdown, or fix equipment while it's quiet.",
    },
    spring: {
      now: "Business picks back up: patios open, graduations, Mother's Day.",
      use: "Get ready for the season: patio, staff, inventory.",
    },
    summer: {
      now: "Patio and tourist season in many places, while others slow down when regulars go on vacation.",
      use: "Staff and stock for the summer, or bridge a slow stretch.",
    },
    fall: {
      now: "The holidays are coming: office parties, catering and gift cards. It's the most profitable stretch for many restaurants, if they're staffed and stocked for it.",
      use: "Stock up and staff up for holiday parties and catering, and build a cushion before the January slowdown.",
    },
  },
};

const HOTEL: Playbook = {
  key: "hotel",
  label: "a hotel",
  plural: "hotels",
  who: "An independent or franchised property with rooms to fill, staff to pay and upkeep that never stops. Revenue swings with the season, and online travel agencies pay on their own schedule.",
  uses: [
    "Room renovations and repairs that keep reviews up",
    "Payroll and supplies through the off-season",
    "Franchise-required upgrades (PIPs)",
  ],
  language: [
    "occupancy and ADR (average daily rate)",
    "OTAs (Expedia, Booking.com)",
    "PIP (franchise property improvement plan)",
    "shoulder season",
    "reviews and rankings",
  ],
  pushback: [
    {
      they: "We're waiting until the busy season.",
      you: "The rooms you fix now are the ones that book at a better rate when it's busy. This is paid back from that revenue.",
    },
  ],
  seasons: {
    winter: {
      now: "Off-season for many properties outside ski and warm destinations: a window for renovations before spring.",
      use: "Fix up rooms while occupancy is low, so they're ready for the busy season.",
    },
    spring: {
      now: "Bookings build toward the summer and event season.",
      use: "Finish upgrades and staff up before the summer rush.",
    },
    summer: {
      now: "Peak season for most leisure travel.",
      use: "Supplies and staff to run full, and repairs that can't wait.",
    },
    fall: {
      now: "The shoulder season, then holiday travel.",
      use: "Holiday-ready upgrades and a cushion for the winter dip.",
    },
  },
};

const RETAIL: Playbook = {
  key: "retail",
  label: "a retail store",
  plural: "retailers",
  who: "A store that buys inventory weeks or months before it sells. The money is on the shelves, and a lot of the year's profit depends on being stocked for the right season.",
  uses: [
    "Holiday or seasonal inventory before the rush",
    "A bulk buy at a supplier discount",
    "Marketing to bring in traffic",
    "Store upgrades: displays, signage, a point-of-sale system",
  ],
  language: [
    "inventory turns",
    "open-to-buy (budget for new stock)",
    "the holiday season",
    "supplier terms and bulk discounts",
    "foot traffic",
  ],
  pushback: [
    {
      they: "I'll wait and see how the season goes.",
      you: "The stores that do best in a season are the ones that bought for it early. Shelves that are empty in December don't sell.",
    },
  ],
  seasons: {
    winter: {
      now: "After the holiday peak comes the January slowdown, returns and clearance.",
      use: "Bridge the slow months, and buy spring stock at good prices.",
    },
    spring: {
      now: "New season stock, tax refund spending, Easter and Mother's Day.",
      use: "Spring inventory and marketing.",
    },
    summer: {
      now: "Back-to-school buying starts in July.",
      use: "Inventory for back-to-school and an early start on holiday orders.",
    },
    fall: {
      now: "Holiday season is about to hit. Black Friday through December is the biggest stretch of the year for most stores, and the inventory has to be on the shelves before it starts.",
      use: "Stock up for the holidays now, and pay it back from holiday sales.",
    },
  },
};

const JEWELRY: Playbook = {
  key: "jewelry",
  label: "a jewelry store",
  plural: "jewelers",
  who: "A jeweler with expensive inventory in the case, custom work and repairs. A handful of seasons make the year: the holidays, Valentine's Day, engagement and wedding season.",
  uses: [
    "Holiday inventory before December",
    "Buying gold or stones when the price is right",
    "Custom orders that need materials before the customer pays in full",
  ],
  language: [
    "engagement season (December to Valentine's Day)",
    "the case and the memo (consignment) goods",
    "custom and bridal",
    "gold price",
    "repairs and walk-ins",
  ],
  pushback: [
    {
      they: "I don't want to overbuy.",
      you: "Fair. What sold out on you last holiday season? Stocking just those is what this is for.",
    },
  ],
  seasons: {
    winter: {
      now: "December is the biggest month of the year, right into engagement season and Valentine's Day.",
      use: "Keep the case full from the holidays through Valentine's Day.",
    },
    spring: {
      now: "Wedding season is coming, plus Mother's Day and graduations.",
      use: "Bridal and gift inventory for the spring and summer.",
    },
    summer: {
      now: "Wedding season, and a slower stretch for walk-in gift buying.",
      use: "Bridal inventory, and planning holiday buys early.",
    },
    fall: {
      now: "The holidays are about to hit. People are buying gifts, and jewelers have to stock the case before December. Engagement season starts right after.",
      use: "Holiday inventory now, paid back from December sales.",
    },
  },
};

const CAR_WASH: Playbook = {
  key: "car_wash",
  label: "a car wash",
  plural: "car washes",
  who: "A car wash with costly equipment, water, chemicals and staff. Volume depends on the weather, and more and more washes run monthly memberships.",
  uses: [
    "Equipment repair or upgrades",
    "Payroll through slow weeks",
    "Marketing a membership program",
  ],
  language: [
    "car count",
    "memberships (unlimited plans)",
    "tunnel and equipment",
    "chemicals and water",
  ],
  pushback: [
    {
      they: "The weather decides my month, not me.",
      you: "That's why payments follow your sales: rainy weeks pay less, sunny weeks more.",
    },
  ],
  seasons: {
    winter: {
      now: "Salt and snow mean big days after every storm, and the cold is hard on equipment.",
      use: "Keep the equipment running for the post-storm rushes.",
    },
    spring: {
      now: "Pollen and the spring clean-up keep the line busy.",
      use: "Upgrades and memberships to lock in the busy season.",
    },
    summer: {
      now: "Steady volume, and a good time to push memberships.",
      use: "Marketing and equipment.",
    },
    fall: {
      now: "Getting the equipment ready before the winter salt season.",
      use: "Repairs and upgrades before winter.",
    },
  },
  warmWinter: {
    now: "Mild weather keeps winter volume steady.",
    use: "Upgrades and memberships.",
  },
};

const LANDSCAPING: Playbook = {
  key: "landscaping",
  label: "a landscaping company",
  plural: "landscapers",
  who: "Crews, trucks and mowers on a seasonal schedule. In cold places many switch to snow removal in winter, which means plows, salt and a second set of equipment.",
  uses: [
    "Equipment: mowers, trucks, a plow",
    "Payroll for crews at the start of the season",
    "Salt and snow gear before the first storm",
  ],
  language: [
    "maintenance contracts",
    "crews and routes",
    "snow removal",
    "salt",
    "the spring rush",
  ],
  pushback: [
    {
      they: "I make my money in the season, I'm fine.",
      you: "And the season starts before the money does. This carries you from the first payroll to the first payments.",
    },
  ],
  seasons: {
    winter: {
      now: "In cold places it's plowing and salting season: equipment and salt costs up front, paid when the property owners pay.",
      use: "Salt, plows and fuel for the storm season.",
    },
    spring: {
      now: "The busiest start of the year: clean-ups, new contracts, every crew back at work at once.",
      use: "Payroll and equipment for the spring rush before the first contracts pay.",
    },
    summer: {
      now: "Mowing routes and installs run full.",
      use: "Another crew or truck to add routes.",
    },
    fall: {
      now: "Leaf clean-ups, then getting plows and salt ready before the first storm.",
      use: "Snow equipment and salt before winter.",
    },
  },
  warmWinter: {
    now: "Year-round work where it doesn't freeze, with winter planting and maintenance.",
    use: "Equipment and crews.",
  },
};

const SCRAP: Playbook = {
  key: "scrap",
  label: "a scrap metal yard",
  plural: "scrap yards",
  who: "A yard buying metal for cash and selling it in bulk to processors and mills. They have to pay sellers on the spot, and their own buyers pay on terms, while metal prices move.",
  uses: [
    "Cash to buy more metal when prices are good",
    "Equipment: a baler, a shear, trucks, containers",
  ],
  language: ["ferrous and non-ferrous", "the spread", "tonnage", "mill prices"],
  pushback: [
    {
      they: "Metal prices are all over the place.",
      you: "Which is why having cash on hand when prices are good matters. This gives you buying power on your schedule.",
    },
  ],
  seasons: {
    winter: {
      now: "Less metal comes in during the cold months.",
      use: "Equipment and repairs while it's slower.",
    },
    spring: {
      now: "Clean-out and construction season brings more metal in.",
      use: "Cash to buy the extra volume.",
    },
    summer: {
      now: "Steady volume from construction and demolition.",
      use: "Buying power and equipment.",
    },
    fall: {
      now: "A last push before winter slows the yard.",
      use: "Buy volume now, and equipment for the winter.",
    },
  },
};

const SERVICE: Playbook = {
  key: "service",
  label: "a service business",
  plural: "service businesses",
  who: "A business that sells its time and skill: labor, parts and travel go out before the customer pays.",
  uses: [
    "Payroll while invoices are paid",
    "Tools, vans and equipment",
    "Marketing to fill the schedule",
  ],
  language: ["the schedule", "service calls", "parts and labor", "repeat customers"],
  pushback: [
    {
      they: "We're doing fine.",
      you: "Good. If you had extra cash this month, where would it make you more money?",
    },
  ],
  seasons: {
    winter: {
      now: "Holiday and year-end bills meet a slower January.",
      use: "Carry payroll through the slow weeks.",
    },
    spring: {
      now: "Customers are spending again after the winter.",
      use: "Tools and staff for the busier months.",
    },
    summer: {
      now: "A steady season for most service work.",
      use: "Grow: another van, another tech.",
    },
    fall: {
      now: "Year-end is coming, and it's the time to set up for next year.",
      use: "Equipment and a cushion for the winter.",
    },
  },
};

const STORAGE: Playbook = {
  key: "storage",
  label: "a storage business",
  plural: "storage operators",
  who: "A self-storage or warehouse operator with steady monthly rent coming in, and building costs, upkeep and expansion going out.",
  uses: [
    "Repairs and upgrades: gates, cameras, units",
    "Expansion: more units or space",
    "Marketing to fill empty units",
  ],
  language: ["occupancy", "units and square feet", "move-ins and move-outs", "rent roll"],
  pushback: [
    {
      they: "Our income is steady.",
      you: "That steady income is what makes this easy to qualify for. What would you add if cash wasn't the hold-up?",
    },
  ],
  seasons: {
    winter: {
      now: "The slowest time for move-ins.",
      use: "Upgrades and marketing before the spring moving season.",
    },
    spring: { now: "Moving season is starting.", use: "Get units ready and marketed." },
    summer: { now: "Peak moving season, and students.", use: "Capacity for the busy months." },
    fall: { now: "Move-ins slow after summer.", use: "Improvements while it's quieter." },
  },
};

const GENERAL: Playbook = {
  key: "general",
  label: "a local business",
  plural: "business owners",
  who: "An established local business. Money comes in from customers and goes out to staff, suppliers and rent, rarely on the same days.",
  uses: [
    "Inventory or supplies ahead of a busy stretch",
    "Equipment that pays for itself",
    "Payroll through a slow month",
    "Marketing to bring in more customers",
  ],
  language: ["cash flow", "the busy season", "suppliers", "growth"],
  pushback: [
    {
      they: "I'm not interested.",
      you: "No problem. Just so I know for later: is there a time of year when cash gets tight for you?",
    },
  ],
  seasons: {
    winter: {
      now: "Year-end bills, then a slower January for many businesses.",
      use: "A cushion through the slow months.",
    },
    spring: {
      now: "Business picks back up after the winter.",
      use: "Get ready for the busy months.",
    },
    summer: {
      now: "Busy for some, slow vacation months for others.",
      use: "Stock for the season, or bridge the slow weeks.",
    },
    fall: {
      now: "The holidays and year-end are coming.",
      use: "Prepare for the year-end rush and a slower January.",
    },
  },
};

export const PLAYBOOKS: Playbook[] = [
  CONTRACTOR,
  TRUCKING,
  AUTO_REPAIR,
  USED_CARS,
  TOWING,
  RESTAURANT,
  HOTEL,
  RETAIL,
  JEWELRY,
  CAR_WASH,
  LANDSCAPING,
  SCRAP,
  SERVICE,
  STORAGE,
  GENERAL,
];

// The engine's industry text, matched in order: the first rule that fits wins.
const INDUSTRY_RULES: [RegExp, Playbook][] = [
  [/jewel/i, JEWELRY],
  [/tow/i, TOWING],
  [/secondhand dealer.*auto|used car|auto (dealer|sales)/i, USED_CARS],
  [/car ?wash/i, CAR_WASH],
  [/landscap|lawn|snow/i, LANDSCAPING],
  [/scrap|recycl|salvage/i, SCRAP],
  [/storage|warehouse/i, STORAGE],
  [/hotel|motel|inn\b|lodging/i, HOTEL],
  [/restaurant|food|pizza|deli|cafe|bakery|bar\b|grill|catering/i, RESTAURANT],
  [/truck|freight|haul|carrier|transport|logistic/i, TRUCKING],
  [/auto|garage|mechanic|collision|body shop|tire/i, AUTO_REPAIR],
  [
    /contract|construct|improvement|plumb|electric|roof|hvac|remodel|renovat|paint|mason|concrete|carpent|labor provider/i,
    CONTRACTOR,
  ],
  [/store|shop|retail|boutique|electronics|appliance dealer/i, RETAIL],
  [/service|laundry|clean|repair/i, SERVICE],
];

const BY_TYPE: Record<string, Playbook> = {
  fleet: TRUCKING,
  contractor: CONTRACTOR,
  auto: AUTO_REPAIR,
};

/**
 * The playbook for a lead: from its industry text first (it's the more specific of the two), then
 * from its lead type, else the general one. "Garage & Parking Lot" is parking, not repair.
 */
export function playbookFor(industry: string | null | undefined, type: string | null): Playbook {
  const text = (industry ?? "").trim();
  if (/parking/i.test(text)) return GENERAL;
  for (const [re, book] of INDUSTRY_RULES) if (re.test(text)) return book;
  return (type && BY_TYPE[type]) || GENERAL;
}

export function seasonOf(date: Date): Season {
  const m = date.getMonth(); // 0 = January
  if (m === 11 || m <= 1) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "fall";
}

// States where winter rarely brings snow and ice to most of the population.
const WARM_STATES = new Set([
  "FL",
  "TX",
  "AZ",
  "CA",
  "LA",
  "HI",
  "NV",
  "GA",
  "SC",
  "AL",
  "MS",
  "PR",
  "NM",
]);
export const warmWinter = (state: string | null | undefined) =>
  WARM_STATES.has((state ?? "").trim().toUpperCase());

/** What is going on in their world right now: the season, adjusted for a warm-winter state. */
export function seasonNote(
  book: Playbook,
  date: Date,
  state: string | null | undefined,
): SeasonNote {
  const season = seasonOf(date);
  if (season === "winter" && book.warmWinter && warmWinter(state)) return book.warmWinter;
  return book.seasons[season];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export type SmartSignal = { signal_type?: string; signal_date?: string; detail?: string };

export type SmartLead = {
  book: Playbook;
  month: string;
  now: SeasonNote;
  /** what this lead's own records add, newest first */
  timing: string[];
  /** where this lead most likely sits on the 5 levels, and the move that takes it up one */
  level: { n: number; name: string; move: string };
  opener: string;
};

const daysBetween = (from: string, to: Date) => {
  const t = Date.parse(`${from.slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? Math.floor((to.getTime() - t) / 86_400_000) : null;
};

/** What a lead's records mean for timing: a recent permit, the renewal window on an advance. */
export function timingFrom(signals: unknown, today: Date): string[] {
  if (!Array.isArray(signals)) return [];
  const out: string[] = [];
  const list = (signals as SmartSignal[]).filter((s) => s && typeof s === "object");
  const newest = (type: string) =>
    list
      .filter((s) => s.signal_type === type && typeof s.signal_date === "string")
      .sort((a, b) => String(b.signal_date).localeCompare(String(a.signal_date)))[0];

  const ucc = newest("mca_ucc");
  if (ucc?.signal_date) {
    const d = daysBetween(ucc.signal_date, today);
    if (d !== null && d >= 0) {
      if (d < 90)
        out.push(
          `A funder filed on them ${d} days ago: the advance is new. Don't push more money now; ask how it's going and call back closer to day 90.`,
        );
      else if (d <= 270)
        out.push(
          `A funder filed on them ${d} days ago, so the advance is likely about half paid down. That's when owners renew, add to it or switch funders: ask what their payback looks like now.`,
        );
      else
        out.push(
          `Their last advance on record is ${d} days old, so it's probably paid off or renewed. Ask how it went and what they'd do differently.`,
        );
    }
  }
  const permit = newest("nyc_permit");
  if (permit?.signal_date) {
    const d = daysBetween(permit.signal_date, today);
    if (d !== null && d >= 0 && d <= 45)
      out.push(
        `They pulled a building permit ${d} days ago${permit.detail ? ` (${permit.detail})` : ""}. The job is starting now, and that's when materials and crew get paid before the customer does.`,
      );
  }
  return out;
}

const LEVELS = [
  {
    n: 1,
    name: "Unaware",
    move: "Find the need first. Ask where extra cash would go this month; don't pitch yet.",
  },
  {
    n: 2,
    name: "Aware",
    move: "They know how it works. Show how fast it funds and how it's paid back from sales, and what's different from last time.",
  },
];

/** The cheat sheet for one lead, as of a date (today in the browser). */
export function smartLead(
  lead: {
    industry?: string | null;
    city?: string | null;
    state?: string | null;
    signals?: unknown;
    owner?: string | null;
  },
  type: string | null,
  today: Date,
): SmartLead {
  const book = playbookFor(lead.industry, type);
  const now = seasonNote(book, today, lead.state);
  const tookAdvance =
    Array.isArray(lead.signals) &&
    (lead.signals as SmartSignal[]).some((s) => s && s.signal_type === "mca_ucc");
  const level = tookAdvance ? LEVELS[1]! : LEVELS[0]!;
  const first = (lead.owner ?? "").trim().split(/\s+/)[0] ?? "";
  const where = (lead.city ?? "").trim();
  const hi = first ? `Hi ${first}, ` : "Hi, ";
  const around = where ? ` around ${where}` : "";
  const opener = `${hi}this is [your name] with Lamp. I work with ${book.plural}${around}. This time of year I hear the same thing from a lot of them: ${now.now} How's that looking for you?`;
  return {
    book,
    month: MONTHS[today.getMonth()]!,
    now,
    timing: timingFrom(lead.signals, today),
    level,
    opener,
  };
}
