import { capitalize, stripHtmlToText, stripNumbers } from "./utils.js";

/**
 * These functions read directly off a PF2e NPC actor's own data (the same
 * data its sheet displays) and turn it into a truthful but NUMBER-FREE
 * description — per GM Core's Recall Knowledge guidance, a success reveals
 * real information but not exact statblock values. Where a raw number has
 * no honest qualitative substitute (e.g. AC, HP), the category focuses on
 * something it *can* say truthfully without a number instead (e.g. which
 * save is comparatively weakest), mirroring the kinds of questions the
 * rules' own examples use ("what's its worst saving throw?").
 */

function typeList(entries = []) {
  return entries.map((e) => capitalize(e.type ?? "")).filter(Boolean);
}

export function extractOverview(actor) {
  const sys = actor.system ?? {};
  const size = sys.traits?.size?.value;
  const rarity = sys.traits?.rarity;
  const traits = (sys.traits?.value ?? []).map(capitalize);

  const lines = [];
  const headerBits = [];
  if (size) headerBits.push(capitalize(size));
  if (rarity && rarity !== "common") headerBits.push(`(${capitalize(rarity)})`);
  if (headerBits.length) lines.push(`<p><strong>${headerBits.join(" ")}</strong></p>`);
  if (traits.length) lines.push(`<p><em>Traits:</em> ${traits.join(", ")}</p>`);

  const publicNotes = sys.details?.publicNotes;
  if (publicNotes && stripHtmlToText(publicNotes)) {
    lines.push(`<div>${publicNotes}</div>`);
  }
  return lines.length ? lines.join("\n") : "<p>Nothing distinctive is noted about this creature's kind.</p>";
}

/** "What's its worst saving throw?" — compare its own saves to each other, no numbers. */
export function extractDefenses(actor) {
  const saves = actor.system?.saves ?? {};
  const entries = Object.entries(saves)
    .filter(([, s]) => s?.value != null)
    .map(([key, s]) => [key, s.value]);

  if (entries.length === 0) return "<p>Nothing notable is known about its defenses.</p>";

  const max = Math.max(...entries.map(([, v]) => v));
  const min = Math.min(...entries.map(([, v]) => v));
  const best = entries.filter(([, v]) => v === max).map(([k]) => capitalize(k));
  const worst = entries.filter(([, v]) => v === min).map(([k]) => capitalize(k));

  if (max === min) {
    return "<p>Its saving throws all seem about equally reliable — no one defense stands out as a weak point.</p>";
  }
  const lines = [`<p><strong>Sturdiest save:</strong> ${best.join(" and ")}</p>`];
  lines.push(`<p><strong>Weakest save:</strong> ${worst.join(" and ")}</p>`);
  return lines.join("\n");
}

export function extractImmunities(actor) {
  const attrs = actor.system?.attributes ?? {};
  const imm = typeList(attrs.immunities);
  const res = typeList(attrs.resistances);
  const weak = typeList(attrs.weaknesses);

  const lines = [];
  if (imm.length) lines.push(`<p><strong>Immune to:</strong> ${imm.join(", ")}</p>`);
  if (res.length) lines.push(`<p><strong>Resistant to:</strong> ${res.join(", ")}</p>`);
  if (weak.length) lines.push(`<p><strong>Weak to:</strong> ${weak.join(", ")}</p>`);
  return lines.length ? lines.join("\n") : "<p>It doesn't seem unusually vulnerable or resistant to anything.</p>";
}

/** "Does it fly/burrow/swim? Can it see in the dark? Does it speak?" — types only, no ranges/bonuses. */
export function extractSenses(actor) {
  const sys = actor.system ?? {};
  const senseTypes = (sys.perception?.senses ?? []).map((s) => capitalize(s.type)).filter(Boolean);
  const languages = (sys.details?.languages?.value ?? sys.traits?.languages?.value ?? []).map(capitalize);
  const moveTypes = (sys.attributes?.speed?.otherSpeeds ?? []).map((o) => capitalize(o.type)).filter(Boolean);
  if (sys.attributes?.speed?.value > 0) moveTypes.unshift("Walk");

  const lines = [];
  lines.push(
    `<p><strong>Senses:</strong> ${senseTypes.length ? senseTypes.join(", ") : "Nothing beyond ordinary sight"}</p>`
  );
  lines.push(`<p><strong>Gets around by:</strong> ${moveTypes.length ? moveTypes.join(", ") : "Walking"}</p>`);
  lines.push(
    `<p><strong>Speaks:</strong> ${languages.length ? languages.join(", ") : "No known language"}</p>`
  );
  return lines.join("\n");
}

export function extractAbilities(actor) {
  const actions = actor.itemTypes?.action ?? [];
  if (!actions.length) return "<p>Nothing beyond what you'd expect from a creature of its kind.</p>";
  const items = actions.map((a) => {
    const desc = stripNumbers(stripHtmlToText(a.system?.description?.value, 240));
    return `<li><strong>${a.name}</strong>${desc ? ` — ${desc}` : ""}</li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

/** "What's its most notable offensive ability?" — names and damage types only, no bonuses/dice. */
export function extractAttacks(actor) {
  const melee = actor.itemTypes?.melee ?? [];
  const spellcasting = actor.itemTypes?.spellcastingEntry ?? [];

  const lines = [];
  if (melee.length) {
    const items = melee.map((m) => {
      const types = Array.from(
        new Set(Object.values(m.system?.damageRolls ?? {}).map((d) => d.damageType).filter(Boolean))
      ).join("/");
      return `<li><strong>${m.name}</strong>${types ? ` (${types})` : ""}</li>`;
    });
    lines.push(`<ul>${items.join("")}</ul>`);
  }
  if (spellcasting.length) {
    const items = spellcasting.map((e) => {
      const tradition = e.system?.tradition?.value;
      return `<li><strong>${e.name}</strong>${tradition ? ` (${capitalize(tradition)} tradition)` : ""}</li>`;
    });
    lines.push(`<ul>${items.join("")}</ul>`);
  }
  return lines.length ? lines.join("\n") : "<p>It doesn't appear to have any notable attacks or spells.</p>";
}

const EXTRACTORS = {
  overview: extractOverview,
  defenses: extractDefenses,
  immunities: extractImmunities,
  senses: extractSenses,
  abilities: extractAbilities,
  attacks: extractAttacks
};

/**
 * Pull one knowledge category's HTML off an actor's sheet, as a
 * number-free, truthful description.
 * @param {Actor} actor
 * @param {string} categoryId one of the ids in categories.js
 * @returns {string} HTML
 */
export function extractCategory(actor, categoryId) {
  const fn = EXTRACTORS[categoryId];
  return fn ? fn(actor) : "<p>Unknown category.</p>";
}
