# Spider Vibes

A Foundry VTT module (Pathfinder 2e) that runs the Remaster **Recall
Knowledge** action the way GM Core actually specifies it — not a
simplified approximation — and compiles what the party learns into a
persistent **Codex** journal other tools can build on.

## The rules this follows

This module's mechanics are built directly from GM Core's Recall Knowledge
rules (skills by trait, p.55; DCs by level, p.53; the repeated-check
escalation rule) rather than a simplified guess at them:

- **Which skill** is suggested from the creature's traits, per the p.55
  table: Arcana for beasts/constructs/dragons/elementals, Crafting for
  constructs, Nature for animals/beasts/elementals/fey/fungi/plants,
  Occultism for aberrations/astral beings/dream & ethereal creatures/oozes/
  spirits/time creatures, Religion for celestials/fiends/monitors/undead,
  Society for humanoid ancestries. An appropriate Lore skill is always
  offered too, and the GM can allow any other skill.
- **DC** = the level-based DC (GM Core p.53) adjusted for the creature's
  **Rarity** (common +0, uncommon +2, rare +5, unique +10), pulled straight
  off the actor. Rolling a Lore skill instead of a general knowledge skill
  automatically knocks the DC down by 2 or 5 (GM's choice, a setting).
- **The roll is secret.** The GM sees the real result; the player never
  learns their own degree of success — only what they're told, or that they
  weren't told anything.
- **Success** reveals real, truthful information — but per GM Core's own
  guidance, never exact numbers (no "weak to fire 10," just "weak to
  fire"). **Critical success** reveals more (a second piece of information,
  standing in for "extra detail, or ask a second question"). **Failure**
  reveals nothing. **Critical failure** reveals something false, presented
  to the player as fact.
- **Repeated attempts on the same creature** are supported and enforced:
  each additional check's DC steps up the Adjusting-DCs ladder one tier
  (Normal → Hard → Very Hard → Incredibly Hard), and the instant a check
  fails, no further attempts on that creature are allowed. A Lore-based
  chain that starts at Easy or Very Easy gets correspondingly more total
  attempts before running out, exactly as described in GM Core.

## What it does, step by step

1. **Trigger it from a macro** (or `/recall` in chat). The module drops a
   ready-to-use **Recall Knowledge** macro into the world macro directory —
   that's the primary way to run it.
2. Target the creature's token, run the macro, and pick a skill (a suggested
   one is pre-selected). If this is the first Recall Knowledge attempt
   against that creature this scene, you also pick a starting difficulty
   (GM discretion); if it's a repeat attempt, the DC is shown as forced to
   the next ladder tier instead, and you can't attempt again if the last
   check failed or already maxed out at Incredibly Hard.
3. Click **Roll**. The check happens through the PF2e system's own skill
   statistic (circumstance bonuses, Hero Point rerolls, etc. all work), but
   **blind** — you won't see your own result.
4. If it was a success, critical success, **or critical failure**, a
   checklist appears with the categories still unknown about that creature,
   phrased around the kind of question the rules' own examples use ("what's
   its worst saving throw?", "is it vulnerable or resistant to anything?"):
   - Overview & Traits
   - Best & Worst Saving Throws
   - Immunities, Resistances & Weaknesses
   - Senses, Languages & Movement
   - Special Abilities
   - Attacks & Spellcasting

   Pick 1 (success or critical failure) or up to 2 (critical success). This
   dialog looks and behaves identically no matter which of those three it
   actually was — the player has no way to tell from the prompt itself
   whether what they're about to learn is true. What you pick on a success
   is pulled from the creature's real sheet data, stripped of exact numbers,
   and written into that creature's page in the **Codex** journal — shared
   across all instances of that "kind" of creature, not just this encounter.
5. On a failure you're told you learned nothing (and the chain ends). On a
   **critical failure**, the category you picked is answered with something
   false, presented to the player as fact. What that false info actually is
   follows a priority order — see below — and it's logged (not to the same
   page the player can read, but to a GM-only page) so there's a record of
   every lie the party's been told.

### What a Critical Failure actually shows

GM Core's own example is a player mistaking a troll for a marsh giant, and
therefore wrongly believing it doesn't regenerate. Spider Vibes automates
that directly instead of asking the GM to hand-write every false statement:

1. **GM-authored false lore, if set.** Open the NPC's sheet and click
   **RK: False Lore** to write specific false info for that creature. If
   present, this always wins.
2. **Otherwise, a real "mistaken identity" creature.** The module searches
   for a genuinely similar creature — same/overlapping traits, comparable
   level — first among **actors already placed in the world**, and only if
   none qualify, among **installed compendium packs**. If one is found, the
   player is shown one of *that* creature's real, number-free categories
   (picked at random, using the same extraction real successes use) as if
   it belonged to the target. The GM-only follow-up message names which
   creature was actually used and which category was shown, so you always
   know what the player was really told.
   - Creatures with the PF2e **unique** trait are never used as the
     stand-in (spoiler risk, and it doesn't fit the "mistaken for a *kind*
     of creature" flavor).
   - Once a creature has been mistaken for something, **it stays mistaken
     for that same thing** — the pick is cached on the creature (an actor
     flag) so repeated critical failures are consistent instead of
     re-rolling a new false identity each time. Search order is world
     actors first, then compendiums; ties are broken by closest level, then
     randomly.
3. **Otherwise, a generic placeholder** telling the GM to improvise —
   used only when there's no GM-authored lore *and* no eligible creature
   was found anywhere (world or compendiums) to mistake it for. (This
   placeholder case is the one thing that's never logged to the False Lore
   page below — there's no actual claim to record.)

### The False Lore log (GM-only)

Every piece of false info a critical failure actually shows a player (GM
lore or a mistaken-identity pick, not the generic placeholder) is logged to
that creature's **False Lore** page — a page that lives in the same Codex
journal as the real info, but is a *separate* `JournalEntryPage` with its
ownership forced to GM-only, independent of whatever the Codex's own
player-facing permission setting is. Players can never see it, even under
the "Owner" Codex setting, because Foundry's ownership check happens
per-page, and GM users bypass ownership checks entirely so it's always
readable to you. Practically, this means:

- The GM-only chat message posted alongside every critical failure includes
  a **"Remove this from the Codex"** button, for when you want to retract a
  lie (the party rerolled and got the truth, you changed your mind about
  the creature, etc.). Clicking it removes just that one entry.
- You can browse the full log for a creature anytime by opening its False
  Lore page directly in the Codex journal (only visible to you).
- It's also available from the API for macros/console use:
  `await api.codex.getFalseInfo(actor)` returns the array of logged entries
  (`{id, categoryId, categoryLabel, html, source, sourceDetail, loggedAt}`,
  where `source` is `"gm-lore"` or `"mistaken-identity"`), and
  `await api.codex.removeFalseInfo(actor, entryId)` retracts one by id.
- Like the real-info page, writes are relayed through a connected GM's
  client if the critical failure happened to resolve on a player's screen
  (e.g. they ran the Recall Knowledge macro themselves) — no elevated
  permissions needed on the player's end for the log to work.

## Installation

1. Unzip `spider-vibes.zip`.
2. Copy the resulting `spider-vibes` folder into your Foundry
   `Data/modules/` directory (so you end up with
   `Data/modules/spider-vibes/module.json`).
3. Restart Foundry (or refresh if it's already running), open your world,
   and enable **Spider Vibes** in *Manage Modules*.
4. Requires the **Pathfinder Second Edition** system, Remaster rules. Built
   and tested conceptually against Foundry v12–v14.
5. The first time a GM logs into the world, the module auto-creates the
   **Spider Vibes Codex** journal and two macros ("Recall Knowledge" and
   "Open Codex") in the macro directory. Drag them to your hotbar, or let
   players use them directly.

### Authoring false info for Critical Failures

Open any NPC's sheet as the GM and click **RK: False Lore** in the sheet
header. Fill in what a critically-failed check tells the player (shown as
fact, never flagged as false to them) and optional GM notes (never shown to
players). This is entirely optional — leave it blank and the module will
automatically fall back to a real similar creature's stats instead (see
above); this field is only for when you want a specific, hand-written lie
instead.

## The Codex, and building on top of it

The Codex is deliberately built as reusable infrastructure, not just a chat
log:

- It's a normal Foundry `JournalEntry` (flagged internally so the module can
  find it again even if renamed), with one `JournalEntryPage` per creature
  "kind" (three goblin tokens share one Goblin entry; a uniquely-named NPC
  gets its own entry). It's locked to **view-only for players by default**
  — see Settings — but writing a new entry is relayed through a connected
  GM's client automatically over Foundry's built-in socket, so nobody needs
  elevated journal permissions for the flow to work end to end.
- Each page also carries structured data at
  `page.flags["spider-vibes"].sections`, e.g.
  `{ immunities: { known: true, html: "...", learnedAt: <worldTime> }, ... }`
  — so other code can check exactly what's known without parsing HTML.
- The module exposes a documented API at
  `game.modules.get("spider-vibes").api`:

  ```js
  const api = game.modules.get("spider-vibes").api;

  api.prompt();                       // open the Recall Knowledge dialog for the current target
  api.editLore(actor);                // open the False Lore editor for an NPC
  api.openCodex();                    // open the Codex journal
  api.openCodex(actor);               // open the Codex straight to that creature's page
  api.resetAttempts(actor);           // clear the escalating-DC chain for every roller against this creature
  api.resetAttempts(actor, roller);   // clear it for just one roller

  await api.codex.getEntry(actor);          // { key, name, sections, page, journal } or null
  await api.codex.getKnownCategories(actor); // e.g. ["overview", "immunities"]
  api.codex.codexKeyForActor(actor);         // the stable key used to group creatures
  api.codex.CATEGORIES;                      // the category id/label/hint list, for building your own UI

  await api.codex.learn(actor, "abilities", "<p>...</p>");
  //    ^ permission-aware: writes directly if the caller can, otherwise relays
  //      through a connected GM automatically. Use this from anything that
  //      might run on a player's client — this is the hook for a future
  //      feature (an "Identify Creature" loot reward, a bestiary browser,
  //      auto-learning on kill) to contribute to the same shared Codex.

  await api.codex.learnCategory(actor, "abilities", "<p>...</p>");
  //    ^ writes directly, no relay — only use from GM-only code paths.

  await api.codex.getFalseInfo(actor);
  //    ^ GM-only data: the logged false-info entries for a creature, e.g.
  //      [{ id, categoryId, categoryLabel, html, source, sourceDetail, loggedAt }, ...]
  //      source is "gm-lore" or "mistaken-identity".

  await api.codex.removeFalseInfo(actor, entryId);
  //    ^ retract one logged false-info entry by id. Returns true if found & removed.

  await api.codex.recordFalseInfo(actor, { categoryId, html, source, sourceDetail });
  //    ^ permission-aware, same relay behavior as api.codex.learn — mainly
  //      for a future feature that wants to log its own false info.
  ```

- A creature is grouped into the Codex by `codexKeyForActor()`: ordinary
  NPCs are keyed by their slugified name; NPCs with the PF2e "unique" trait
  get their own per-actor entry. A GM can force a specific grouping with an
  actor flag: `actor.setFlag("spider-vibes", "codexKey", "my-key")`.

## Settings

- **Roll Recall Knowledge in secret** (on by default) — the roll is made
  blind and the player-facing chat card never shows the DC or outcome, only
  the resulting information (or its absence). Turn off for tables that
  prefer open rolls.
- **Lore skill DC reduction** (`-2` default, or `-5`) — how much easier a
  Lore skill makes the check versus a general knowledge skill, and how much
  further the repeat-check ladder can stretch when starting from Lore.
- **Reveal successes to the whole party** (off by default) — show
  Success/Critical Success results to every player instead of whispering to
  just the roller and GM.
- **Codex journal name** — used only the first time the Codex is created.
- **Player permission on the Codex** — `Observer` (default, locked/view-only)
  relays new knowledge through a connected GM automatically; `Owner` lets
  players write to the journal directly, at the cost of also being able to
  edit or delete any entry. Only applied the first time the Codex is
  created — change it anytime afterward from the journal's own *Configure
  Permissions* dialog.

## Notes and limitations

- The suggested skill-by-trait mapping and sheet extraction are a
  best-effort implementation of GM Core's guidance, not a verbatim rules
  citation — you can always override the skill in the dialog, and the Codex
  page is just a normal journal page you can hand-edit afterward.
- Stripping numbers from free-text ability descriptions is done with a blunt
  regex (any digit run is removed), so grammar can occasionally read a bit
  oddly ("within feet" instead of "within 30 feet"). It reliably keeps raw
  statblock numbers from leaking, at a small cost to prose quality.
- The escalating-DC repeat-check chain is tracked in memory per (roller,
  creature, current combat) — it resets on a world reload and naturally
  resets between different combat encounters, but persists indefinitely
  outside of combat until reset. Use `api.resetAttempts()` to clear it by
  hand if needed.
- If the rolling actor doesn't have the chosen skill available through the
  PF2e system (e.g. a non-PF2e actor, or a Lore skill it doesn't possess),
  the module falls back to a simple manual-modifier `1d20` roll, still made
  blind if secret rolling is on.
- The mistaken-identity pick for a creature is cached as an actor flag
  (`flags.spider-vibes.mistakenIdentity`, a UUID), so unlike the escalating
  attempt-tracker it survives world reloads. Clear it by hand (delete the
  flag, or via a macro) if you want a fresh pick — e.g. after significantly
  changing which creatures exist in the world.
- With the default `Observer` Codex setting, saving new knowledge needs a
  connected GM to relay the write — if the whole table is players-only with
  no GM logged in, results still display in chat but won't persist until
  someone relays or manually adds them. The same applies to logging false
  info to the (GM-only) False Lore page.
- The False Lore page's GM-only visibility comes entirely from Foundry's
  per-page ownership (`ownership.default: NONE`), not from hiding it in the
  UI — if you ever manually change that page's permissions in the journal's
  own Configure Permissions dialog, its contents become visible to whoever
  you grant access to. Leave it alone unless you specifically want to share
  a creature's false-lore history with someone.
- Manually editing a False Lore page's text in the journal editor won't
  update its underlying data — the page's text is only regenerated by the
  module itself (when a new entry is logged or one is removed), so a hand
  edit will just get overwritten the next time something changes there. Use
  the "Remove this from the Codex" chat button or `api.codex.removeFalseInfo`
  to retract an entry instead of editing the page directly.
- The module uses Foundry's classic `Dialog` API for its prompts for the
  broadest compatibility across v12–v14; you may see a harmless deprecation
  warning in the console on newer versions.

## File structure

```
spider-vibes/
├─ module.json
├─ LICENSE.txt
├─ scripts/
│  ├─ main.js         # hooks, dialogs, secret-roll flow, repeat-check ladder, chat cards
│  ├─ dc-table.js      # DC-by-level table, Rarity adjustments, the Adjusting-DCs ladder
│  ├─ skill-map.js     # trait → suggested skill mapping (GM Core p.55)
│  ├─ categories.js    # the 6 knowledge categories, with example in-character questions
│  ├─ extract.js       # pulls each category's data off an actor's sheet, number-free
│  ├─ mistaken-identity.js  # finds a similar real creature for automatic Crit-Fail false info
│  ├─ codex.js         # Codex journal storage, GM-relay socket, public API
│  └─ utils.js         # shared helpers (module id, template/dialog compat, number-stripping)
├─ templates/
│  ├─ recall-dialog.hbs
│  ├─ category-picker.hbs
│  ├─ chat-card.hbs
│  └─ lore-editor.hbs
├─ styles/
│  └─ recall-knowledge.css
└─ lang/
   └─ en.json
```

Fan content permitted under Paizo's Community Use Policy; not published,
endorsed, or specifically approved by Paizo. Pathfinder is a registered
trademark of Paizo Inc.
