/**
 * Creature trait -> skill mapping straight off the GM Core "Recall
 * Knowledge" table (GM Core p.55): Arcana for beasts/constructs/dragons/
 * elementals, Crafting for constructs, Nature for animals/beasts/
 * elementals/fey/fungi/plants, Occultism for aberrations/astral beings/
 * dream & ethereal creatures/oozes/spirits/time creatures, Religion for
 * celestials/fiends/monitors/undead, Society for humanoid ancestries.
 * `giant` and `void` aren't in that table — they're left in as a
 * best-effort extrapolation, marked below. A specific Lore skill is always
 * an option regardless of traits (handled in the dialog, not here), and the
 * GM can always allow other skills at their discretion.
 */
export const TRAIT_SKILL_MAP = {
  aberration: ["occultism"],
  animal: ["nature"],
  astral: ["occultism"],
  beast: ["arcana", "nature"],
  celestial: ["religion"],
  construct: ["arcana", "crafting"],
  dragon: ["arcana"],
  dream: ["occultism"],
  elemental: ["arcana", "nature"],
  ethereal: ["occultism"],
  fey: ["nature"],
  fiend: ["religion"],
  fungus: ["nature"],
  giant: ["society"], // not in the p.55 table — extrapolated from Society covering humanoid ancestries
  humanoid: ["society"],
  monitor: ["religion"],
  ooze: ["occultism"],
  plant: ["nature"],
  spirit: ["occultism"],
  time: ["occultism"],
  undead: ["religion"],
  void: ["occultism"] // not in the p.55 table — extrapolated alongside astral/ethereal/dream/time
};

/**
 * All standard (non-Lore) PF2e skills, used to populate the skill dropdown.
 */
export const STANDARD_SKILLS = [
  "acrobatics",
  "arcana",
  "athletics",
  "crafting",
  "deception",
  "diplomacy",
  "intimidation",
  "medicine",
  "nature",
  "occultism",
  "performance",
  "religion",
  "society",
  "stealth",
  "survival",
  "thievery"
];

/**
 * Given a creature's trait list, return the deduplicated set of suggested
 * skill slugs. Falls back to Society (the generic "creature lore" skill)
 * if nothing in the trait list maps to anything specific.
 * @param {string[]} traits
 * @returns {string[]}
 */
export function getSuggestedSkills(traits = []) {
  const set = new Set();
  for (const t of traits) {
    const key = typeof t === "string" ? t.toLowerCase() : null;
    if (key && TRAIT_SKILL_MAP[key]) {
      for (const skill of TRAIT_SKILL_MAP[key]) set.add(skill);
    }
  }
  if (set.size === 0) set.add("society");
  return Array.from(set);
}
