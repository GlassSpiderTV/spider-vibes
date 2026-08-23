/**
 * Recall Knowledge — DC by creature level
 * Values follow the standard PF2e "DCs by Level" table (Core Rulebook / GM Core),
 * which is the table the Recall Knowledge rules point to for computing the base DC.
 */
export const DC_BY_LEVEL = {
  "-1": 13,
  "0": 14,
  "1": 15,
  "2": 16,
  "3": 18,
  "4": 19,
  "5": 20,
  "6": 22,
  "7": 23,
  "8": 24,
  "9": 26,
  "10": 27,
  "11": 28,
  "12": 30,
  "13": 31,
  "14": 32,
  "15": 34,
  "16": 35,
  "17": 36,
  "18": 38,
  "19": 39,
  "20": 40,
  "21": 42,
  "22": 44,
  "23": 46,
  "24": 48,
  "25": 50
};

/**
 * Returns the base Recall Knowledge DC for a given creature level.
 * Levels outside the official -1..25 range are extrapolated using the
 * same ~+2-per-level progression the table settles into at the high end.
 * @param {number} level
 * @returns {number}
 */
export function getDCByLevel(level) {
  const lvl = Number(level);
  if (Number.isNaN(lvl)) return 20;
  const key = String(Math.round(lvl));
  if (key in DC_BY_LEVEL) return DC_BY_LEVEL[key];
  if (lvl > 25) return 50 + (Math.round(lvl) - 25) * 2;
  if (lvl < -1) return Math.max(6, 13 - (-1 - Math.round(lvl)) * 1);
  return 20;
}

/**
 * The "Adjusting DCs" ladder (GM Core). This does double duty in this
 * module: the GM can pick a starting tier for situational reasons (a
 * creature that's unusually well-known/obscure for its kind), and it's also
 * the exact ladder Recall Knowledge's repeated-attempt rule steps up one
 * tier per additional check (Normal -> Hard -> Very Hard -> Incredibly
 * Hard). Key order matters — it IS the ladder order, easiest to hardest.
 */
export const DC_ADJUSTMENTS = {
  "incredibly-easy": { label: "Incredibly Easy", value: -10 },
  "very-easy": { label: "Very Easy", value: -5 },
  "easy": { label: "Easy", value: -2 },
  "normal": { label: "Normal", value: 0 },
  "hard": { label: "Hard", value: 2 },
  "very-hard": { label: "Very Hard", value: 5 },
  "incredibly-hard": { label: "Incredibly Hard", value: 10 }
};

/** Ladder tier keys in order, easiest to hardest — used for repeat-attempt escalation. */
export const DC_LADDER = Object.keys(DC_ADJUSTMENTS);

/**
 * Recall Knowledge's DC is the level-based DC adjusted for the creature's
 * Rarity (GM Core p.53): common is unmodified, and rarer creatures are
 * harder to know about.
 */
export const RARITY_ADJUSTMENTS = {
  common: { label: "Common", value: 0 },
  uncommon: { label: "Uncommon", value: 2 },
  rare: { label: "Rare", value: 5 },
  unique: { label: "Unique", value: 10 }
};

export function getRarityAdjustment(rarity) {
  return RARITY_ADJUSTMENTS[rarity]?.value ?? 0;
}
