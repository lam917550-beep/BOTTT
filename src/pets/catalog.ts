export const PET_CATEGORIES = [
  "beast",
  "fantasy",
  "dragon",
  "mythical",
  "aquatic",
  "bird",
  "robot",
  "elemental",
  "alien",
  "ancient",
  "magical",
  "seasonal",
  "secret",
  "boss",
] as const;
export type PetCategory = (typeof PET_CATEGORIES)[number];

export const PET_RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic", "divine", "secret"] as const;
export type PetRarity = (typeof PET_RARITIES)[number];

export const PET_PERSONALITIES = [
  "brave",
  "lazy",
  "funny",
  "smart",
  "curious",
  "calm",
  "chaotic",
  "loyal",
  "shy",
  "energetic",
] as const;
export type PetPersonality = (typeof PET_PERSONALITIES)[number];

export interface PetDefinition {
  id: string;
  name: string;
  category: PetCategory;
  rarity: PetRarity;
  personality: PetPersonality;
  baseStats: { health: number; energy: number; loyalty: number };
  evolvesTo: string | null;
  skills: string[];
  synergyWith: string[];
  secret: boolean;
}

const NAMES = [
  "Emberpup", "Frostkit", "Voltbyte", "Mossback", "Nimbus", "Pyreling", "Aqualyn", "Shardwing",
  "Cobalt", "Lumen", "Thornu", "Glimmer", "Ravyn", "Pebble", "Zephyr", "Onyxie", "Sable", "Ivyloop",
  "Draklet", "Starfin", "Quark", "Mochi", "Bramble", "Aurora", "Nixie", "Titanling", "Wisp", "Kite",
  "Rune", "Pearl", "Cinder", "Lotus", "Hexbit", "Solace", "Mirage", "Fable", "Orbit", "Pudding",
  "Gale", "Root", "Spark", "Tide", "Flint", "Bloom", "Echo", "Prism", "Dusk", "Dawn",
];

export function buildPetCatalog(): PetDefinition[] {
  const pets: PetDefinition[] = [];
  for (let i = 0; i < 120; i += 1) {
    const category = PET_CATEGORIES[i % PET_CATEGORIES.length];
    const rarity = PET_RARITIES[Math.min(PET_RARITIES.length - 1, Math.floor(i / 16))];
    const personality = PET_PERSONALITIES[i % PET_PERSONALITIES.length];
    const id = `p_${String(i + 1).padStart(3, "0")}`;
    const evo = i < 80 ? `p_${String(i + 21).padStart(3, "0")}` : null;
    pets.push({
    id,
    name: `${NAMES[i % NAMES.length]} ${category}`,
    category: category as PetCategory,
    rarity: (i >= 118 ? "secret" : rarity) as PetRarity,
    personality: personality as PetPersonality,
      baseStats: {
        health: 80 + (i % 40),
        energy: 70 + (i % 30),
        loyalty: 8 + (i % 20),
      },
      evolvesTo: evo && evo !== id ? evo : null,
      skills: i % 2 === 0 ? ["passive_xp", "find_food"] : ["active_boost", "guard"],
      synergyWith: i > 0 ? [`p_${String((i % 120) + 1).padStart(3, "0")}`] : [],
      secret: i >= 118,
    });
  }
  const ids = new Set(pets.map((p) => p.id));
  if (ids.size !== pets.length) throw new Error("Duplicate pet ids");
  return pets;
}

let catalog: PetDefinition[] | undefined;
const byId = new Map<string, PetDefinition>();

export function getPetCatalog(): PetDefinition[] {
  if (!catalog) {
    catalog = buildPetCatalog();
    for (const p of catalog) byId.set(p.id, p);
  }
  return catalog;
}

export function getPetDef(id: string): PetDefinition | undefined {
  getPetCatalog();
  return byId.get(id);
}

export function starterPetId(): string {
  return "p_001";
}

export function petOfTheDay(now = new Date()): PetDefinition {
  const list = getPetCatalog().filter((p) => !p.secret);
  const day = Math.floor(now.getTime() / 86_400_000);
  const pet = list[day % list.length];
  if (!pet) throw new Error("empty pets");
  return pet;
}

export function validatePetCatalog(): string[] {
  const errors: string[] = [];
  const list = getPetCatalog();
  if (list.length < 100) errors.push(`expected >=100 pets, got ${list.length}`);
  return errors;
}
