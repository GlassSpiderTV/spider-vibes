/**
 * The knowledge categories Recall Knowledge can reveal about an NPC, pulled
 * off its actual sheet but phrased around the kind of in-character question
 * the GM Core rules expect the player to ask (e.g. "is it weak to
 * anything?", "what's its worst saving throw?"). Order here is also the
 * order sections are printed on a Codex journal page.
 */
export const CATEGORIES = [
  {
    id: "overview",
    label: "Overview & Traits",
    hint: 'e.g. "What kind of creature is this? Can it be reasoned with? Where does it live?"'
  },
  {
    id: "defenses",
    label: "Best & Worst Saving Throws",
    hint: 'e.g. "What\'s its worst saving throw?"'
  },
  {
    id: "immunities",
    label: "Immunities, Resistances & Weaknesses",
    hint: 'e.g. "Is it highly vulnerable or resistant to anything?"'
  },
  {
    id: "senses",
    label: "Senses, Languages & Movement",
    hint: 'e.g. "Can it see in the dark? Does it fly, burrow, or swim? Does it speak?"'
  },
  {
    id: "abilities",
    label: "Special Abilities",
    hint: 'e.g. "What\'s its most notable ability, and is there a way to counter it?"'
  },
  {
    id: "attacks",
    label: "Attacks & Spellcasting",
    hint: 'e.g. "What\'s its most notable offensive ability?"'
  }
];

export function categoryLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}
