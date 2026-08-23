import { getDCByLevel, getRarityAdjustment, DC_ADJUSTMENTS, DC_LADDER } from "./dc-table.js";
import { getSuggestedSkills, STANDARD_SKILLS } from "./skill-map.js";
import { CATEGORIES, categoryLabel } from "./categories.js";
import { extractCategory } from "./extract.js";
import { findMistakenIdentity } from "./mistaken-identity.js";
import {
  codexKeyForActor,
  getOrCreateJournal,
  getCodexEntry,
  getKnownCategories,
  learnCategory,
  requestLearnCategory,
  requestSetMistakenIdentity,
  initCodexSocket,
  openCodex
} from "./codex.js";
import {
  MODULE_ID,
  capitalize,
  getRenderTemplate,
  getFormDataExtended,
  root,
  enrichUuidLink
} from "./utils.js";

const OUTCOME_LABEL = {
  criticalSuccess: "Critical Success",
  success: "Success",
  failure: "Failure",
  criticalFailure: "Critical Failure"
};

/**
 * Derive a PF2e degree of success (as a string) from a raw total, natural die
 * result, and DC. Used only as a fallback when we can't read the outcome the
 * PF2e system itself already computed (e.g. non-PF2e actor, or a future
 * system update changes where the flag lives).
 */
function deriveOutcome(total, natural, dc) {
  let tier; // 0 crit fail, 1 fail, 2 success, 3 crit success
  if (total >= dc + 10) tier = 3;
  else if (total >= dc) tier = 2;
  else if (total <= dc - 10) tier = 0;
  else tier = 1;
  if (natural === 20) tier = Math.min(3, tier + 1);
  if (natural === 1) tier = Math.max(0, tier - 1);
  return ["criticalFailure", "failure", "success", "criticalSuccess"][tier];
}

/* ------------------------ Repeated-attempt tracking ------------------------ *
 * GM Core: "as soon as a character fails a Recall Knowledge check they      *
 * cannot make any further checks on that subject," and each additional     *
 * check's DC steps up the Adjusting-DCs ladder one tier at a time. This is  *
 * session-local (in-memory) state, scoped per (roller, creature, combat) —  *
 * it intentionally resets on a world reload or a new encounter.            */
const ATTEMPT_STATE = new Map();

function attemptKey(rollingActor, targetActor) {
  return `${rollingActor.uuid}|${targetActor.uuid}|${game.combat?.id ?? "no-combat"}`;
}

function getAttemptState(rollingActor, targetActor) {
  return ATTEMPT_STATE.get(attemptKey(rollingActor, targetActor)) ?? null;
}

function recordAttempt(rollingActor, targetActor, usedIndex, outcome) {
  const prev = getAttemptState(rollingActor, targetActor);
  const failed = outcome === "failure" || outcome === "criticalFailure";
  ATTEMPT_STATE.set(attemptKey(rollingActor, targetActor), {
    lastIndex: usedIndex,
    failed,
    count: (prev?.count ?? 0) + 1
  });
}

/** Manually clear a Recall Knowledge attempt chain (e.g. a GM wants to allow a re-try). */
function resetAttempts(targetActor, rollingActor = null) {
  if (rollingActor) {
    ATTEMPT_STATE.delete(attemptKey(rollingActor, targetActor));
    return;
  }
  for (const key of Array.from(ATTEMPT_STATE.keys())) {
    if (key.includes(`|${targetActor.uuid}|`)) ATTEMPT_STATE.delete(key);
  }
}

/**
 * Work out which ladder tier a given (actor, target) pair's NEXT Recall
 * Knowledge attempt uses. Returns either a blocked result (chain over) or
 * the ladder index/attempt number to use, applying the GM's chosen starting
 * tier and the Lore-skill discount on a fresh chain, or the forced
 * next-tier-up index on a continuing one.
 */
function resolveTierIndex(rollingActor, targetActor, formAdjustmentKey, isLore, loreShiftSteps) {
  const state = getAttemptState(rollingActor, targetActor);
  if (state) {
    if (state.failed) return { blocked: true, reason: "failed" };
    const nextIndex = state.lastIndex + 1;
    if (nextIndex >= DC_LADDER.length) return { blocked: true, reason: "maxed" };
    return { blocked: false, index: nextIndex, forced: true, attemptNumber: state.count + 1 };
  }
  const rawIndex = DC_LADDER.indexOf(formAdjustmentKey || "normal");
  const shift = isLore ? loreShiftSteps : 0;
  const index = Math.min(DC_LADDER.length - 1, Math.max(0, (rawIndex === -1 ? 3 : rawIndex) - shift));
  return { blocked: false, index, forced: false, attemptNumber: 1 };
}

/* --------------------------------- Dialogs --------------------------------- */

async function promptManualModifier(actorName, skillLabel) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (val) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };
    new Dialog({
      title: "Manual Skill Roll",
      content: `<form class="recall-knowledge-dialog">
        <p>${actorName} has no "${skillLabel}" statistic the module can roll automatically
        (this happens with non-PF2e actors or custom Lore skills). Enter the total
        modifier to roll with instead.</p>
        <div class="form-group">
          <label>Total modifier</label>
          <input type="number" name="mod" value="0" step="1" autofocus />
        </div>
      </form>`,
      buttons: {
        roll: {
          icon: '<i class="fa-solid fa-dice-d20"></i>',
          label: "Roll",
          callback: (html) => {
            const el = root(html).querySelector('[name="mod"]');
            finish(Number(el?.value) || 0);
          }
        },
        cancel: {
          icon: '<i class="fa-solid fa-xmark"></i>',
          label: "Cancel",
          callback: () => finish(null)
        }
      },
      default: "roll",
      close: () => finish(null)
    }).render(true);
  });
}

/** Build a clickable link to a creature's Codex page, if one exists. */
async function buildCodexLink(targetActor) {
  try {
    const entry = await getCodexEntry(targetActor);
    if (!entry?.page) return "";
    const link = await enrichUuidLink(entry.page.uuid, `Codex: ${entry.page.name}`);
    return `<i class="fa-solid fa-book"></i> ${link}`;
  } catch (err) {
    console.warn("Recall Knowledge | couldn't build a Codex link", err);
    return "";
  }
}

/**
 * Resolves (and caches) the "mistaken identity" stand-in creature used for
 * an automatic Critical Failure false-info reveal. Per the user's request,
 * once a creature has been mistaken for something, it keeps being mistaken
 * for that same thing on every subsequent critical failure — so the cached
 * `mistakenIdentity` flag is checked first, and only if it's missing or no
 * longer resolves (e.g. the stand-in actor was deleted) does this search
 * for a fresh one and cache it via the permission-aware relay.
 *
 * @param {Actor} targetActor
 * @returns {Promise<{actor: Actor, uuid: string}|null>}
 */
async function resolveMistakenIdentity(targetActor) {
  const cachedUuid = targetActor.getFlag(MODULE_ID, "mistakenIdentity");
  if (cachedUuid) {
    try {
      const cachedActor = await fromUuid(cachedUuid);
      if (cachedActor) return { actor: cachedActor, uuid: cachedUuid };
    } catch (err) {
      console.warn("Spider Vibes | cached mistaken-identity UUID no longer resolves", err);
    }
  }

  const pick = await findMistakenIdentity(targetActor);
  if (!pick) return null;

  const mistakenActor = await fromUuid(pick.uuid);
  if (!mistakenActor) return null;

  await requestSetMistakenIdentity(targetActor, pick.uuid);
  return { actor: mistakenActor, uuid: pick.uuid };
}

/**
 * GM-only message with the real DC/roll/outcome, since the roll itself is
 * secret from the player (GM Core: "the player does not know how well or
 * how poorly they did").
 */
async function postGmDetail(targetActor, rollingActor, skillSlug, dc, outcome) {
  const gmIds = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  if (gmIds.length === 0) return;
  await ChatMessage.create({
    speaker: { alias: "Recall Knowledge (GM only)" },
    content: `<p><strong>${rollingActor.name}</strong> vs <strong>${targetActor.name}</strong> — ${capitalize(
      skillSlug
    )}, DC ${dc}: <strong>${OUTCOME_LABEL[outcome] ?? outcome}</strong></p>`,
    whisper: gmIds
  });
}

/**
 * The player-facing message. Deliberately never mentions the DC or the
 * degree of success — only the resulting information (or its absence) —
 * so the player can't infer how well they rolled from the card itself.
 */
async function postPlayerCard(targetActor, { outcome, text, sections, codexLink, rollingUser }) {
  const renderTemplate = getRenderTemplate();
  const content = await renderTemplate(`modules/${MODULE_ID}/templates/chat-card.hbs`, {
    name: targetActor.name,
    text,
    sections,
    codexLink
  });

  const revealToAll =
    game.settings.get(MODULE_ID, "revealToAll") && (outcome === "success" || outcome === "criticalSuccess");
  const gmIds = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  const whisper = revealToAll ? [] : Array.from(new Set([rollingUser?.id, ...gmIds].filter(Boolean)));

  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: targetActor }),
    content,
    whisper
  });
}

class RecallKnowledge {
  /** Open the prompt dialog for the player's currently-targeted token. */
  static async prompt() {
    const target = Array.from(game.user.targets)[0]?.actor;
    if (!target) {
      ui.notifications.warn("Target a creature's token first, then run Recall Knowledge.");
      return;
    }

    let rollingActors = canvas.tokens.controlled
      .map((t) => t.actor)
      .filter((a) => a && a.isOwner && a.id !== target.id);
    if (rollingActors.length === 0 && game.user.character) rollingActors = [game.user.character];
    if (rollingActors.length === 0) {
      rollingActors = game.actors.filter((a) => a.isOwner && a.type === "character");
    }
    if (rollingActors.length === 0 && game.user.isGM) {
      rollingActors = game.actors.filter((a) => a.type === "character" || a.type === "npc");
    }
    if (rollingActors.length === 0) {
      ui.notifications.warn(
        "No eligible actor to roll with. Select a token you own, or assign yourself a character."
      );
      return;
    }

    const level = target.system?.details?.level?.value ?? 0;
    const rarity = target.system?.traits?.rarity ?? "common";
    const traits = target.system?.traits?.value ?? [];
    const suggested = getSuggestedSkills(traits);
    const baseDC = getDCByLevel(level) + getRarityAdjustment(rarity);
    const loreShiftSteps = game.settings.get(MODULE_ID, "loreReduction") === "-5" ? 2 : 1;

    const skills = STANDARD_SKILLS.map((slug) => ({
      slug,
      label: capitalize(slug),
      suggested: suggested.includes(slug)
    }));

    const adjustments = Object.fromEntries(
      Object.entries(DC_ADJUSTMENTS).map(([key, val]) => [
        key,
        { ...val, selected: key === "normal", signedValue: val.value > 0 ? `+${val.value}` : `${val.value}` }
      ])
    );

    const renderTemplate = getRenderTemplate();
    const content = await renderTemplate(`modules/${MODULE_ID}/templates/recall-dialog.hbs`, {
      targetName: target.name,
      rarityLabel: capitalize(rarity),
      multipleActors: rollingActors.length > 1,
      rollingActors: rollingActors.map((a) => ({ id: a.id, name: a.name })),
      skills,
      adjustments,
      baseDC
    });

    new Dialog(
      {
        title: `Recall Knowledge — ${target.name}`,
        content,
        render: (html) => {
          const el = root(html);
          const dcSpan = el.querySelector(".rk-dc");
          const actorSelect = el.querySelector('[name="actorId"]');
          const adjSelect = el.querySelector('[name="adjustment"]');
          const adjustmentGroup = el.querySelector("[data-adjustment-group]");
          const banner = el.querySelector(".rk-attempt-banner");
          const skillSelect = el.querySelector('[name="skill"]');
          const customGroup = el.querySelector("[data-custom-skill-group]");

          const toggleCustom = () => {
            if (customGroup) customGroup.style.display = skillSelect.value === "__custom__" ? "" : "none";
          };

          const recompute = () => {
            const actorId = actorSelect ? actorSelect.value : rollingActors[0].id;
            const rollingActor = rollingActors.find((a) => a.id === actorId) ?? rollingActors[0];
            const isLore = skillSelect.value === "__custom__";
            const result = resolveTierIndex(rollingActor, target, adjSelect?.value, isLore, loreShiftSteps);

            if (result.blocked) {
              if (adjustmentGroup) adjustmentGroup.style.display = "none";
              if (banner) {
                banner.style.display = "";
                banner.innerHTML =
                  result.reason === "failed"
                    ? `<p class="rk-warning">${rollingActor.name} already failed a Recall Knowledge check against this creature — no further attempts are allowed this scene.</p>`
                    : `<p class="rk-warning">${rollingActor.name} has already reached Incredibly Hard against this creature — no further attempts are allowed this scene.</p>`;
              }
              dcSpan.textContent = "—";
              return;
            }

            const tierKey = DC_LADDER[result.index];
            const dc = baseDC + DC_ADJUSTMENTS[tierKey].value;
            dcSpan.textContent = String(dc);

            if (result.forced) {
              if (adjustmentGroup) adjustmentGroup.style.display = "none";
              if (banner) {
                banner.style.display = "";
                banner.innerHTML = `<p>Attempt #${result.attemptNumber} against this creature this scene — DC forced to <strong>${DC_ADJUSTMENTS[tierKey].label}</strong> by the escalating-DC rule.</p>`;
              }
            } else {
              if (adjustmentGroup) adjustmentGroup.style.display = "";
              if (banner) banner.style.display = "none";
            }
          };

          actorSelect?.addEventListener("change", recompute);
          adjSelect?.addEventListener("change", recompute);
          skillSelect?.addEventListener("change", () => {
            toggleCustom();
            recompute();
          });
          toggleCustom();
          recompute();
        },
        buttons: {
          roll: {
            icon: '<i class="fa-solid fa-dice-d20"></i>',
            label: "Roll",
            callback: async (html) => {
              const FormDataExtended = getFormDataExtended();
              const form = root(html).querySelector("form");
              const data = new FormDataExtended(form).object;

              let skillSlug = data.skill;
              const isLore = skillSlug === "__custom__";
              if (isLore) {
                skillSlug = String(data.customSkill || "")
                  .trim()
                  .toLowerCase()
                  .replace(/\s+/g, "-");
                if (!skillSlug) {
                  ui.notifications.warn("Enter a Lore skill slug (e.g. dragon-lore).");
                  return;
                }
              }

              const actorId = data.actorId || rollingActors[0].id;
              const rollingActor = rollingActors.find((a) => a.id === actorId) || rollingActors[0];

              const result = resolveTierIndex(rollingActor, target, data.adjustment, isLore, loreShiftSteps);
              if (result.blocked) {
                ui.notifications.warn(
                  result.reason === "failed"
                    ? `${rollingActor.name} already failed a Recall Knowledge check against ${target.name} — no further attempts allowed this scene.`
                    : `${rollingActor.name} has already reached Incredibly Hard against ${target.name} — no further attempts allowed this scene.`
                );
                return;
              }

              const tierKey = DC_LADDER[result.index];
              const finalDC = baseDC + DC_ADJUSTMENTS[tierKey].value;

              await RecallKnowledge.rollCheck(rollingActor, target, skillSlug, finalDC, result.index);
            }
          },
          cancel: {
            icon: '<i class="fa-solid fa-xmark"></i>',
            label: "Cancel"
          }
        },
        default: "roll"
      },
      { width: 440, classes: ["recall-knowledge-dialog"] }
    ).render(true);
  }

  /**
   * Roll `skillSlug` for `rollingActor` against `dc`. The roll is secret by
   * default (GM Core: the player doesn't learn their own degree of success),
   * then this hands off to handleOutcome to reveal Codex-backed knowledge
   * (or false info) about `targetActor`, and records the attempt for the
   * escalating-DC repeat-check rule.
   */
  static async rollCheck(rollingActor, targetActor, skillSlug, dc, usedIndex) {
    const secret = game.settings.get(MODULE_ID, "secretRolls");
    const skillStat = rollingActor.skills?.[skillSlug];
    let outcome;

    if (skillStat?.check?.roll) {
      const rollResult = await skillStat.check.roll({
        dc: { value: dc, visible: !secret },
        extraRollOptions: ["action:recall-knowledge"],
        createMessage: true,
        rollMode: secret ? CONST.DICE_ROLL_MODES.BLIND : undefined
      });
      if (!rollResult) return; // player cancelled the PF2e roll dialog

      const lastMessage = game.messages.contents.at(-1);
      outcome = lastMessage?.getFlag("pf2e", "context")?.outcome;
      if (!outcome) {
        const total = rollResult.total ?? 0;
        const natural =
          rollResult.terms?.[0]?.results?.[0]?.result ?? rollResult.dice?.[0]?.total ?? null;
        outcome = deriveOutcome(total, natural, dc);
      }

      // Belt-and-suspenders: force the message blind even if the rollMode
      // hint above wasn't honored, so the roller genuinely can't see it.
      if (secret && lastMessage && !lastMessage.blind) {
        await lastMessage
          .update({ blind: true, whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id) })
          .catch((err) => console.warn("Recall Knowledge | couldn't blind the roll message", err));
      }
    } else {
      const mod = await promptManualModifier(rollingActor.name, capitalize(skillSlug));
      if (mod === null) return; // cancelled

      const roll = await new Roll("1d20 + @mod", { mod }).evaluate();
      await roll.toMessage(
        {
          speaker: ChatMessage.getSpeaker({ actor: rollingActor }),
          flavor: `Recall Knowledge (${capitalize(skillSlug)})`
        },
        secret ? { rollMode: CONST.DICE_ROLL_MODES.BLIND } : {}
      );
      const natural = roll.terms?.[0]?.results?.[0]?.result ?? null;
      outcome = deriveOutcome(roll.total, natural, dc);
    }

    recordAttempt(rollingActor, targetActor, usedIndex, outcome);
    await RecallKnowledge.handleOutcome(targetActor, rollingActor, skillSlug, dc, outcome, game.user);
  }

  /**
   * Given a resolved degree of success, either reveal false info (critical
   * failure), nothing (failure), or let the player choose real sheet-derived
   * categories to learn and record into the Codex (success / crit success).
   * A GM-only message with the true DC/outcome is always posted first.
   */
  static async handleOutcome(targetActor, rollingActor, skillSlug, dc, outcome, rollingUser) {
    await postGmDetail(targetActor, rollingActor, skillSlug, dc, outcome);

    if (outcome === "criticalFailure") {
      const lore = targetActor.getFlag(MODULE_ID, "lore") || {};
      let text = lore.falseInfo;
      let mistakenNote = "";

      if (!text) {
        const mistaken = await resolveMistakenIdentity(targetActor);
        if (mistaken) {
          const catId = CATEGORIES[Math.floor(Math.random() * CATEGORIES.length)].id;
          text = extractCategory(mistaken.actor, catId);
          mistakenNote = `This is actually ${mistaken.actor.name}'s "${categoryLabel(catId)}" info — the player mistook ${targetActor.name} for it.`;
        }
      }

      if (!text) {
        text =
          "You recall something about this creature... and you're certain of it. (No similar creature or GM-authored false lore was found — improvise something plausible but wrong.)";
      }

      await postPlayerCard(targetActor, { outcome, text, rollingUser });

      const gmOnlyLines = [
        "Critical failure: the text above was shown to the player as fact, but it is FALSE."
      ];
      if (mistakenNote) gmOnlyLines.push(mistakenNote);
      if (lore.gmNotes) gmOnlyLines.push(`GM notes: ${lore.gmNotes}`);
      await ChatMessage.create({
        speaker: { alias: "Recall Knowledge (GM only)" },
        content: `<p>${gmOnlyLines.join("<br><br>")}</p>`,
        whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id)
      });
      return;
    }

    if (outcome === "failure") {
      await postPlayerCard(targetActor, {
        outcome,
        text: "You can't recall anything useful about this creature right now.",
        rollingUser
      });
      return;
    }

    // success or criticalSuccess: let the player pick real categories to learn.
    // GM Core: success answers one question; critical success answers it plus
    // either extra detail or a second question — approximated here as picking
    // 1 category on a success, or up to 2 on a critical success.
    const maxPicks = outcome === "criticalSuccess" ? 2 : 1;
    const known = new Set(await getKnownCategories(targetActor));
    const available = CATEGORIES.filter((c) => !known.has(c.id));

    if (available.length === 0) {
      const codexLink = await buildCodexLink(targetActor);
      await postPlayerCard(targetActor, {
        outcome,
        text: "The party already knows everything Recall Knowledge can reveal about this creature.",
        codexLink,
        rollingUser
      });
      return;
    }

    const picks = await RecallKnowledge.promptCategoryPicker(
      targetActor.name,
      available,
      Math.min(maxPicks, available.length)
    );
    if (!picks || picks.length === 0) return;

    const sections = [];
    let anyUnsaved = false;
    for (const catId of picks) {
      const html = extractCategory(targetActor, catId);
      const result = await requestLearnCategory(targetActor, catId, html, { displayName: targetActor.name });
      if (!result) anyUnsaved = true;
      sections.push({ label: categoryLabel(catId), html });
    }

    const codexLink = await buildCodexLink(targetActor);
    const text = anyUnsaved
      ? "(No GM was online to save this to the Codex — the info below is accurate, but you'll want to add it yourself later.)"
      : undefined;
    await postPlayerCard(targetActor, { outcome, text, sections, codexLink, rollingUser });
  }

  /** Checkbox dialog letting the player choose which questions/categories to learn. */
  static promptCategoryPicker(targetName, categories, maxPicks) {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = (val) => {
        if (resolved) return;
        resolved = true;
        resolve(val);
      };
      const renderTemplate = getRenderTemplate();
      renderTemplate(`modules/${MODULE_ID}/templates/category-picker.hbs`, {
        targetName,
        maxPicks,
        isPlural: maxPicks > 1,
        categories
      }).then((content) => {
        new Dialog(
          {
            title: `Recall Knowledge — What do you learn about ${targetName}?`,
            content,
            render: (html) => {
              const el = root(html);
              const boxes = Array.from(el.querySelectorAll('input[name="cat"]'));
              const sync = () => {
                const checkedCount = boxes.filter((b) => b.checked).length;
                for (const b of boxes) b.disabled = !b.checked && checkedCount >= maxPicks;
              };
              boxes.forEach((b) => b.addEventListener("change", sync));
            },
            buttons: {
              confirm: {
                icon: '<i class="fa-solid fa-book"></i>',
                label: "Learn",
                callback: (html) => {
                  const el = root(html);
                  const picked = Array.from(el.querySelectorAll('input[name="cat"]:checked')).map(
                    (b) => b.value
                  );
                  finish(picked);
                }
              },
              cancel: {
                icon: '<i class="fa-solid fa-xmark"></i>',
                label: "Skip",
                callback: () => finish([])
              }
            },
            default: "confirm",
            close: () => finish([])
          },
          { width: 420, classes: ["recall-knowledge-dialog"] }
        ).render(true);
      });
    });
  }

  /** Open the GM-only editor for what a Critical Failure reveals about an NPC. */
  static async openLoreEditor(actor) {
    const lore = actor.getFlag(MODULE_ID, "lore") || {};
    const renderTemplate = getRenderTemplate();
    const content = await renderTemplate(`modules/${MODULE_ID}/templates/lore-editor.hbs`, {
      name: actor.name,
      falseInfo: lore.falseInfo ?? "",
      gmNotes: lore.gmNotes ?? ""
    });

    new Dialog(
      {
        title: `Recall Knowledge — ${actor.name}`,
        content,
        buttons: {
          save: {
            icon: '<i class="fa-solid fa-floppy-disk"></i>',
            label: "Save",
            callback: async (html) => {
              const FormDataExtended = getFormDataExtended();
              const form = root(html).querySelector("form");
              const data = new FormDataExtended(form).object;
              await actor.setFlag(MODULE_ID, "lore", data);
            }
          },
          cancel: {
            icon: '<i class="fa-solid fa-xmark"></i>',
            label: "Cancel"
          }
        },
        default: "save"
      },
      { width: 480, classes: ["recall-knowledge-dialog"] }
    ).render(true);
  }
}

/* ---------------------------------- Hooks ---------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "secretRolls", {
    name: "RECALLKNOWLEDGE.Settings.SecretRolls.Name",
    hint: "RECALLKNOWLEDGE.Settings.SecretRolls.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "loreReduction", {
    name: "RECALLKNOWLEDGE.Settings.LoreReduction.Name",
    hint: "RECALLKNOWLEDGE.Settings.LoreReduction.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "-2": "-2 (Easy)",
      "-5": "-5 (Very Easy)"
    },
    default: "-2"
  });

  game.settings.register(MODULE_ID, "revealToAll", {
    name: "RECALLKNOWLEDGE.Settings.RevealToAll.Name",
    hint: "RECALLKNOWLEDGE.Settings.RevealToAll.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "codexJournalName", {
    name: "RECALLKNOWLEDGE.Settings.CodexJournalName.Name",
    hint: "RECALLKNOWLEDGE.Settings.CodexJournalName.Hint",
    scope: "world",
    config: true,
    type: String,
    default: "Spider Vibes Codex"
  });

  game.settings.register(MODULE_ID, "codexOwnership", {
    name: "RECALLKNOWLEDGE.Settings.CodexOwnership.Name",
    hint: "RECALLKNOWLEDGE.Settings.CodexOwnership.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      OBSERVER: "Observer — view only for players (recommended); new knowledge is relayed through an online GM automatically",
      OWNER: "Owner — players can add and edit Codex entries directly"
    },
    default: "OBSERVER"
  });

  initCodexSocket();
});

Hooks.once("ready", async () => {
  globalThis.RecallKnowledge = RecallKnowledge;
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      prompt: RecallKnowledge.prompt,
      editLore: RecallKnowledge.openLoreEditor,
      openCodex,
      resetAttempts,
      codex: {
        getEntry: getCodexEntry,
        getKnownCategories,
        learn: requestLearnCategory,
        learnCategory,
        codexKeyForActor,
        getOrCreateJournal,
        openCodex,
        CATEGORIES
      }
    };
  }

  if (game.user.isGM) {
    await getOrCreateJournal().catch((err) => console.error("Recall Knowledge | codex init failed", err));

    const macroDefs = [
      {
        flagKey: "isLauncher",
        name: "Recall Knowledge",
        img: "icons/magic/perception/eye-ringed-glow-angry-small-red.webp",
        command: `game.modules.get("${MODULE_ID}").api.prompt();`
      },
      {
        flagKey: "isCodexLauncher",
        name: "Open Codex",
        img: "icons/sundries/books/book-red-exclamation.webp",
        command: `game.modules.get("${MODULE_ID}").api.openCodex();`
      }
    ];
    for (const def of macroDefs) {
      const exists = game.macros.some((m) => m.getFlag(MODULE_ID, def.flagKey));
      if (!exists) {
        await Macro.create({
          name: def.name,
          type: "script",
          img: def.img,
          command: def.command,
          flags: { [MODULE_ID]: { [def.flagKey]: true } }
        });
      }
    }
    ui.notifications.info('Recall Knowledge: "Recall Knowledge" and "Open Codex" macros are in your macro directory.');
  }
});

// "/recall" — target a token, type /recall, hit enter.
// "/codex" — open the Codex journal.
Hooks.on("chatMessage", (_chatLog, message) => {
  const trimmed = message.trim().toLowerCase();
  if (trimmed === "/recall") {
    RecallKnowledge.prompt();
    return false;
  }
  if (trimmed === "/codex") {
    openCodex();
    return false;
  }
  return true;
});

// GM-only header button on NPC sheets to author what a Critical Failure reveals.
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.actor;
  if (!actor || actor.type !== "npc" || !game.user.isGM) return;
  buttons.unshift({
    label: "RK: False Lore",
    class: "recall-knowledge-lore-btn",
    icon: "fa-solid fa-brain",
    onclick: () => RecallKnowledge.openLoreEditor(actor)
  });
});
