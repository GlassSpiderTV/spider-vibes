/**
 * Finds a real NPC to serve as an automatic "mistaken identity" for a
 * Critical Failure. Per GM Core's own example ("mistake the troll for a
 * marsh giant, and therefore don't know it has regeneration"), the false
 * info this generates isn't invented text — it's a genuinely similar
 * creature's real, number-free stats (via the same extraction used for
 * real successes) presented as if they belonged to the target.
 *
 * World actors already placed in the game are tried first (a mix-up with
 * something the party could plausibly know about); only if nothing
 * suitable exists there does the search widen to installed compendium
 * packs. Unique creatures are never used as the stand-in — revealing a
 * specific named individual's real stats under a false name is a spoiler
 * risk, and "mistaken for a unique person" doesn't fit the "mistaken for a
 * kind of creature" flavor this is going for anyway.
 */

function traitOverlapScore(targetTraits, candidateTraits) {
  const targetSet = new Set(targetTraits.filter((t) => t !== "unique"));
  const candidateSet = new Set((candidateTraits ?? []).filter((t) => t !== "unique"));
  let overlap = 0;
  for (const t of targetSet) if (candidateSet.has(t)) overlap++;
  return overlap;
}

function pickBest(candidates, targetTraits, targetLevel) {
  const scored = candidates
    .map((c) => ({
      ...c,
      overlap: traitOverlapScore(targetTraits, c.traits),
      levelDiff: Math.abs((c.level ?? 0) - targetLevel)
    }))
    .filter((c) => c.overlap > 0);
  if (scored.length === 0) return null;

  const topOverlap = Math.max(...scored.map((c) => c.overlap));
  const topTier = scored.filter((c) => c.overlap === topOverlap);
  const minLevelDiff = Math.min(...topTier.map((c) => c.levelDiff));
  const finalists = topTier.filter((c) => c.levelDiff === minLevelDiff);
  return finalists[Math.floor(Math.random() * finalists.length)];
}

function isEligible(traits) {
  return !(traits ?? []).includes("unique");
}

function candidatesFromWorld(targetActor) {
  return game.actors
    .filter((a) => a.type === "npc" && a.id !== targetActor.id && a.name !== targetActor.name)
    .map((a) => ({
      uuid: a.uuid,
      name: a.name,
      traits: a.system?.traits?.value ?? [],
      level: a.system?.details?.level?.value ?? 0
    }))
    .filter((c) => isEligible(c.traits));
}

async function candidatesFromCompendiums(targetActor) {
  const candidates = [];
  const packs = game.packs.filter((p) => p.documentName === "Actor");
  for (const pack of packs) {
    try {
      const index = await pack.getIndex({
        fields: ["type", "system.traits.value", "system.details.level.value"]
      });
      for (const entry of index) {
        if (entry.type !== "npc" || entry.name === targetActor.name) continue;
        const traits = entry.system?.traits?.value ?? [];
        if (!isEligible(traits)) continue;
        candidates.push({
          uuid: entry.uuid ?? `Compendium.${pack.collection}.Actor.${entry._id}`,
          name: entry.name,
          traits,
          level: entry.system?.details?.level?.value ?? 0
        });
      }
    } catch (err) {
      console.warn(`Spider Vibes | couldn't index compendium pack ${pack.collection}`, err);
    }
  }
  return candidates;
}

/**
 * @param {Actor} targetActor
 * @returns {Promise<{uuid:string, name:string, overlap:number, levelDiff:number}|null>}
 */
export async function findMistakenIdentity(targetActor) {
  const traits = targetActor.system?.traits?.value ?? [];
  const level = targetActor.system?.details?.level?.value ?? 0;

  const worldPick = pickBest(candidatesFromWorld(targetActor), traits, level);
  if (worldPick) return worldPick;

  const compendiumCandidates = await candidatesFromCompendiums(targetActor);
  return pickBest(compendiumCandidates, traits, level);
}
