import type { Pool } from "pg";
import { getPetDef } from "./catalog.js";

export type PetAction = "feed" | "play" | "train" | "walk" | "sleep" | "groom" | "care" | "heal" | "interact";

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

export function derivedPetState(row: {
  hunger: number;
  energy: number;
  happiness: number;
  cleanliness: number;
  last_care_at: Date;
}): { hunger: number; energy: number; happiness: number; cleanliness: number; mood: string } {
  const hours = Math.max(0, (Date.now() - row.last_care_at.getTime()) / 3_600_000);
  const hunger = clamp(row.hunger + hours * 4);
  const energy = clamp(row.energy - hours * 3);
  const happiness = clamp(row.happiness - hours * 2);
  const cleanliness = clamp(row.cleanliness - hours * 1.5);
  let mood = "happy";
  if (hunger > 70) mood = "hungry";
  else if (energy < 25) mood = "sleepy";
  else if (happiness < 30) mood = "sad";
  else if (cleanliness < 25) mood = "angry";
  else if (happiness > 80) mood = "excited";
  return { hunger, energy, happiness, cleanliness, mood };
}

export class PetService {
  constructor(private pool: Pool) {}

  async list(userId: string) {
    const res = await this.pool.query(
      `SELECT id, pet_def_id, nickname, level, xp, health, hunger, energy, happiness, cleanliness, loyalty, bond, last_care_at, expedition_until, expedition_kind
       FROM owned_pets WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    return res.rows.map((row) => ({ ...row, derived: derivedPetState(row), def: getPetDef(row.pet_def_id) }));
  }

  async act(userId: string, petId: string, action: PetAction) {
    const res = await this.pool.query(
      `SELECT * FROM owned_pets WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [petId, userId],
    );
    const pet = res.rows[0];
    if (!pet) throw new Error("PET_NOT_FOUND");
    const d = derivedPetState(pet);
    const patch: Record<string, number> = {};
    if (action === "feed") {
      patch.hunger = clamp(d.hunger - 30);
      patch.happiness = clamp(d.happiness + 8);
    } else if (action === "play" || action === "interact") {
      patch.happiness = clamp(d.happiness + 15);
      patch.energy = clamp(d.energy - 10);
      patch.bond = pet.bond + 2;
    } else if (action === "train") {
      patch.xp = pet.xp + 12;
      patch.energy = clamp(d.energy - 15);
      patch.bond = pet.bond + 3;
    } else if (action === "walk") {
      patch.energy = clamp(d.energy - 8);
      patch.happiness = clamp(d.happiness + 10);
      patch.cleanliness = clamp(d.cleanliness - 5);
    } else if (action === "sleep") {
      patch.energy = clamp(d.energy + 35);
    } else if (action === "groom" || action === "care") {
      patch.cleanliness = clamp(d.cleanliness + 25);
      patch.happiness = clamp(d.happiness + 6);
    } else if (action === "heal") {
      patch.health = clamp(pet.health + 20);
    }
    const fields = Object.keys(patch);
    if (fields.length === 0) throw new Error("INVALID_ACTION");
    const sets = fields.map((f, i) => `${f} = $${i + 3}`).join(", ");
    const values = fields.map((f) => patch[f]);
    await this.pool.query(
      `UPDATE owned_pets SET ${sets}, last_care_at = now() WHERE id = $1 AND user_id = $2`,
      [petId, userId, ...values],
    );
    const list = await this.list(userId);
    return list.find((p) => p.id === petId);
  }

  async startExpedition(userId: string, petId: string, minutes = 30) {
    const until = new Date(Date.now() + minutes * 60_000);
    const upd = await this.pool.query(
      `UPDATE owned_pets SET expedition_until = $3, expedition_kind = 'hunt'
       WHERE id = $1 AND user_id = $2 AND (expedition_until IS NULL OR expedition_until < now())`,
      [petId, userId, until],
    );
    if (upd.rowCount !== 1) throw new Error("EXPEDITION_BUSY");
    return { until };
  }

  async collectExpedition(userId: string, petId: string) {
    const res = await this.pool.query(
      `UPDATE owned_pets SET expedition_until = NULL, expedition_kind = NULL, xp = xp + 20, bond = bond + 5
       WHERE id = $1 AND user_id = $2 AND expedition_until IS NOT NULL AND expedition_until <= now()
       RETURNING id`,
      [petId, userId],
    );
    if (!res.rows[0]) throw new Error("EXPEDITION_NOT_READY");
    return { rewardItem: "material_dust", xp: 20 };
  }
}
