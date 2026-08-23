import { MODULE_ID, slugify } from "./utils.js";
import { CATEGORIES, categoryLabel } from "./categories.js";

/**
 * The Codex is a single world JournalEntry (auto-created) with one
 * JournalEntryPage per creature "kind". Everything the party has learned
 * about a creature via Recall Knowledge accumulates on that page, both as
 * rendered HTML (for people reading the journal) and as structured flag
 * data (`flags.spider-vibes.sections`) so other macros, modules,
 * or a future feature can read exactly what's known without re-parsing HTML.
 *
 * This file is the module's public data layer — see the `codex` object
 * exported from main.js's module API for the supported entry points.
 */

/**
 * A creature's Codex key groups all instances of "the same creature" into
 * one page. Ordinary NPCs are keyed by their (slugified) name, so three
 * "Goblin Warrior" tokens all share one entry. NPCs with the PF2e "unique"
 * trait get their own per-actor entry instead, since a unique named NPC
 * isn't "a kind of creature" other instances would share knowledge with.
 * A GM can override this by setting the `codexKey` flag on an actor.
 */
export function codexKeyForActor(actor) {
  const override = actor.getFlag(MODULE_ID, "codexKey");
  if (override) return override;
  const isUnique = (actor.system?.traits?.value ?? []).includes("unique");
  return isUnique ? `unique-${actor.id}` : `kind-${slugify(actor.name)}`;
}

function renderCodexBody(name, sections) {
  const parts = [`<h2>${name}</h2>`];
  for (const cat of CATEGORIES) {
    const sec = sections[cat.id];
    if (sec?.known) {
      parts.push(`<h3>${cat.label}</h3>`);
      parts.push(sec.html);
    }
  }
  return parts.join("\n");
}

/**
 * Find (or create) the world's Codex JournalEntry. Looked up by flag, not by
 * a stored ID, so this keeps working even if the GM renames it.
 */
export async function getOrCreateJournal() {
  let journal = game.journal.find((j) => j.getFlag(MODULE_ID, "isCodex"));
  if (journal) return journal;

  const ownershipChoice = game.settings.get(MODULE_ID, "codexOwnership") || "OBSERVER";
  const ownershipLevel =
    CONST.DOCUMENT_OWNERSHIP_LEVELS[ownershipChoice] ?? CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;

  try {
    journal = await JournalEntry.create({
      name: game.settings.get(MODULE_ID, "codexJournalName") || "Spider Vibes Codex",
      flags: { [MODULE_ID]: { isCodex: true } },
      ownership: { default: ownershipLevel }
    });
  } catch (err) {
    console.error("Recall Knowledge | failed to create the Codex journal", err);
    ui.notifications?.error(
      'Recall Knowledge: could not create the Codex journal. Ask your GM to log in once (it auto-creates on ready), or create a Journal Entry and toggle its "isCodex" flag manually.'
    );
    return null;
  }
  return journal;
}

function findPage(journal, key) {
  return journal.pages.find((p) => p.getFlag(MODULE_ID, "codexKey") === key);
}

/**
 * Look up what's currently known about a creature.
 * @param {Actor|string} actorOrKey an NPC actor, or an explicit codex key
 * @returns {Promise<{key:string, name:string, sections:object, page:JournalEntryPage, journal:JournalEntry}|null>}
 */
export async function getCodexEntry(actorOrKey) {
  const journal = await getOrCreateJournal();
  if (!journal) return null;
  const key = typeof actorOrKey === "string" ? actorOrKey : codexKeyForActor(actorOrKey);
  const page = findPage(journal, key);
  if (!page) return null;
  const sections = page.getFlag(MODULE_ID, "sections") || {};
  return { key, name: page.name, sections, page, journal };
}

/** @returns {Promise<string[]>} category ids already known for this creature */
export async function getKnownCategories(actorOrKey) {
  const entry = await getCodexEntry(actorOrKey);
  if (!entry) return [];
  return Object.keys(entry.sections).filter((id) => entry.sections[id]?.known);
}

export async function isCategoryKnown(actorOrKey, categoryId) {
  const known = await getKnownCategories(actorOrKey);
  return known.includes(categoryId);
}

/**
 * Record a piece of knowledge about a creature, merging it into (or
 * creating) that creature's Codex page.
 * @param {Actor} actor the creature the knowledge is about
 * @param {string} categoryId a category id from categories.js (or any custom string)
 * @param {string} html the HTML to store/display for that category
 * @param {{displayName?: string}} [options]
 * @returns {Promise<{key:string, page:JournalEntryPage, sections:object}>}
 */
export async function learnCategory(actor, categoryId, html, { displayName } = {}) {
  const journal = await getOrCreateJournal();
  if (!journal) throw new Error("Recall Knowledge: no Codex journal available.");

  const key = codexKeyForActor(actor);
  const name = displayName ?? actor.name;
  let page = findPage(journal, key);
  const sections = { ...(page?.getFlag(MODULE_ID, "sections") ?? {}) };
  sections[categoryId] = { known: true, html, learnedAt: game.time?.worldTime ?? Date.now?.() ?? 0 };
  const bodyHtml = renderCodexBody(name, sections);

  if (page) {
    await page.update({
      "text.content": bodyHtml,
      [`flags.${MODULE_ID}.sections`]: sections
    });
  } else {
    const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name,
        type: "text",
        text: { content: bodyHtml, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
        flags: { [MODULE_ID]: { codexKey: key, sections, sourceActorUuid: actor.uuid } }
      }
    ]);
    page = created;
  }

  return { key, page, sections };
}

/* --------------------------- False Lore log (GM-only) --------------------------- */

/**
 * Everything a Critical Failure has told a player about a creature is
 * logged too — not on the same page players can read, but on a sibling
 * page in the same Codex journal with its ownership forced to NONE, so it
 * never leaks to players even under the "Owner" Codex setting (GM users
 * bypass Foundry's ownership checks entirely, so this stays fully readable
 * to any GM regardless). Each entry is individually removable — see
 * `removeFalseInfo` — for when a GM wants to retract or clean up a lie
 * (e.g. after the party rerolls and learns the truth, or the GM changes
 * their mind about what the creature actually was).
 */
function findFalsePage(journal, key) {
  return journal.pages.find((p) => p.getFlag(MODULE_ID, "falseLoreKey") === key);
}

function renderFalseLoreBody(name, entries) {
  const parts = [`<h2>${name} — False Lore Log (GM Only)</h2>`];
  if (!entries.length) {
    parts.push("<p><em>No false information has been given out yet.</em></p>");
    return parts.join("\n");
  }
  for (const e of entries) {
    parts.push(`<h3>${e.categoryLabel} <span style="font-weight:normal;font-size:0.85em;">(id: ${e.id})</span></h3>`);
    if (e.sourceDetail) parts.push(`<p><em>${e.sourceDetail}</em></p>`);
    parts.push(e.html);
  }
  return parts.join("\n");
}

/**
 * Log a piece of Critical-Failure false info to the (GM-only) False Lore
 * page for this creature, creating that page on first use.
 * @param {Actor} actor the creature the false info was attributed to
 * @param {{categoryId:string, html:string, source?:string, sourceDetail?:string}} opts
 * @returns {Promise<{key:string, page:JournalEntryPage, entry:object}>}
 */
export async function recordFalseInfo(actor, { categoryId, html, source, sourceDetail } = {}) {
  const journal = await getOrCreateJournal();
  if (!journal) throw new Error("Recall Knowledge: no Codex journal available.");

  const key = codexKeyForActor(actor);
  const name = actor.name;
  let page = findFalsePage(journal, key);
  const entries = [...(page?.getFlag(MODULE_ID, "falseEntries") ?? [])];
  const entry = {
    id: foundry.utils.randomID(),
    categoryId,
    categoryLabel: categoryLabel(categoryId),
    html,
    source: source ?? "unknown",
    sourceDetail: sourceDetail ?? "",
    loggedAt: game.time?.worldTime ?? Date.now?.() ?? 0
  };
  entries.push(entry);
  const bodyHtml = renderFalseLoreBody(name, entries);

  if (page) {
    await page.update({
      "text.content": bodyHtml,
      [`flags.${MODULE_ID}.falseEntries`]: entries
    });
  } else {
    const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [
      {
        name: `${name} — False Lore (GM Only)`,
        type: "text",
        text: { content: bodyHtml, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
        // Forced hidden from everyone but GMs (who bypass ownership checks
        // entirely), regardless of the Codex's own player-facing setting.
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE },
        flags: { [MODULE_ID]: { falseLoreKey: key, isFalseLore: true, falseEntries: entries, sourceActorUuid: actor.uuid } }
      }
    ]);
    page = created;
  }

  return { key, page, entry };
}

/** @returns {Promise<object[]>} the logged false-info entries for a creature (GM-only data) */
export async function getFalseInfo(actorOrKey) {
  const journal = await getOrCreateJournal();
  if (!journal) return [];
  const key = typeof actorOrKey === "string" ? actorOrKey : codexKeyForActor(actorOrKey);
  const page = findFalsePage(journal, key);
  return page?.getFlag(MODULE_ID, "falseEntries") ?? [];
}

/**
 * Retract one logged false-info entry (e.g. from the "Remove this from the
 * Codex" link on the GM-only chat message, or called directly by a GM).
 * Always runs GM-side — the False Lore page's ownership is GM-only, so
 * there's nothing to relay: a GM user always has direct write access.
 * @returns {Promise<boolean>} whether an entry was found and removed
 */
export async function removeFalseInfo(actor, entryId) {
  const journal = await getOrCreateJournal();
  if (!journal) return false;
  const key = codexKeyForActor(actor);
  const page = findFalsePage(journal, key);
  if (!page) return false;

  const before = page.getFlag(MODULE_ID, "falseEntries") ?? [];
  const entries = before.filter((e) => e.id !== entryId);
  if (entries.length === before.length) return false;

  const bodyHtml = renderFalseLoreBody(actor.name, entries);
  await page.update({
    "text.content": bodyHtml,
    [`flags.${MODULE_ID}.falseEntries`]: entries
  });
  return true;
}

/**
 * Permission-aware way to log false info from wherever the Critical
 * Failure was actually resolved (often a player's client, if a player ran
 * the macro themselves) — mirrors `requestLearnCategory`'s GM-relay
 * pattern, since the False Lore page's ownership is always GM-only.
 * @returns {Promise<{key:string, entryId:string, pageUuid:string}|null>}
 */
export async function requestRecordFalseInfo(actor, opts = {}) {
  if (game.user.isGM) {
    const result = await recordFalseInfo(actor, opts);
    return { key: result.key, entryId: result.entry.id, pageUuid: result.page.uuid };
  }

  const hasConnectedGM = game.users.some((u) => u.isGM && u.active);
  if (!hasConnectedGM) return null;

  const requestId = foundry.utils.randomID();
  const responsePromise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      PENDING_REQUESTS.delete(requestId);
      resolve({ ok: false });
    }, 15000);
    PENDING_REQUESTS.set(requestId, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  game.socket.emit(SOCKET_EVENT, {
    type: "record-false-request",
    requestId,
    actorUuid: actor.uuid,
    categoryId: opts.categoryId,
    html: opts.html,
    source: opts.source,
    sourceDetail: opts.sourceDetail
  });

  const response = await responsePromise;
  if (!response.ok) return null;
  return { key: response.key, entryId: response.entryId, pageUuid: response.pageUuid };
}

/* --------------------------- GM-relay for locked-down Codexes --------------------------- */

/**
 * When the Codex is locked to view-only for players (the "Observer" setting),
 * a player's client has no permission to write a new page/update into the
 * journal directly. Rather than requiring that, we relay the write through
 * Foundry's built-in socket to whichever GM client is connected, which
 * performs the actual write on the player's behalf and reports back the
 * result. This needs no extra dependency (no socketlib) — just Foundry's
 * own `game.socket`.
 */
const SOCKET_EVENT = `module.${MODULE_ID}`;
const PENDING_REQUESTS = new Map();
let socketRegistered = false;

/** Call once (e.g. on the `init` hook) to start listening for relay requests/responses. */
export function initCodexSocket() {
  if (socketRegistered) return;
  socketRegistered = true;

  game.socket.on(SOCKET_EVENT, async (payload) => {
    if (!payload || typeof payload !== "object") return;

    // Any "*-response" is just resolving a pending promise on the requester's
    // own client — handle those generically regardless of which request type
    // they answer.
    if (typeof payload.type === "string" && payload.type.endsWith("-response")) {
      const resolvePending = PENDING_REQUESTS.get(payload.requestId);
      if (resolvePending) {
        PENDING_REQUESTS.delete(payload.requestId);
        resolvePending(payload);
      }
      return;
    }

    // Only one connected GM should act on a given request. `activeGM` (when
    // available) picks a single canonical GM; otherwise every GM client
    // would try to process the same request redundantly.
    const canonicalGmId = game.users.activeGM?.id;
    const isResponsible = game.user.isGM && (!canonicalGmId || canonicalGmId === game.user.id);
    if (!isResponsible) return;

    if (payload.type === "learn-request") {
      try {
        const actor = await fromUuid(payload.actorUuid);
        if (!actor) throw new Error("actor not found");
        const result = await learnCategory(actor, payload.categoryId, payload.html, {
          displayName: payload.displayName
        });
        game.socket.emit(SOCKET_EVENT, {
          type: "learn-response",
          requestId: payload.requestId,
          ok: true,
          key: result.key,
          pageUuid: result.page.uuid,
          pageName: result.page.name
        });
      } catch (err) {
        console.error("Spider Vibes | GM relay failed to record Codex knowledge", err);
        game.socket.emit(SOCKET_EVENT, {
          type: "learn-response",
          requestId: payload.requestId,
          ok: false,
          error: String(err?.message ?? err)
        });
      }
      return;
    }

    if (payload.type === "set-mistaken-request") {
      try {
        const actor = await fromUuid(payload.actorUuid);
        if (!actor) throw new Error("actor not found");
        await actor.setFlag(MODULE_ID, "mistakenIdentity", payload.mistakenUuid);
        game.socket.emit(SOCKET_EVENT, { type: "set-mistaken-response", requestId: payload.requestId, ok: true });
      } catch (err) {
        console.error("Spider Vibes | GM relay failed to set a mistaken identity", err);
        game.socket.emit(SOCKET_EVENT, {
          type: "set-mistaken-response",
          requestId: payload.requestId,
          ok: false,
          error: String(err?.message ?? err)
        });
      }
      return;
    }

    if (payload.type === "record-false-request") {
      try {
        const actor = await fromUuid(payload.actorUuid);
        if (!actor) throw new Error("actor not found");
        const result = await recordFalseInfo(actor, {
          categoryId: payload.categoryId,
          html: payload.html,
          source: payload.source,
          sourceDetail: payload.sourceDetail
        });
        game.socket.emit(SOCKET_EVENT, {
          type: "record-false-response",
          requestId: payload.requestId,
          ok: true,
          key: result.key,
          entryId: result.entry.id,
          pageUuid: result.page.uuid
        });
      } catch (err) {
        console.error("Spider Vibes | GM relay failed to record false lore", err);
        game.socket.emit(SOCKET_EVENT, {
          type: "record-false-response",
          requestId: payload.requestId,
          ok: false,
          error: String(err?.message ?? err)
        });
      }
    }
  });
}

async function canWriteCodexDirectly(journal) {
  if (!journal) return false;
  if (typeof journal.testUserPermission === "function") {
    return journal.testUserPermission(game.user, "OWNER");
  }
  return !!journal.isOwner;
}

/**
 * The permission-aware way to record Codex knowledge. Writes directly if the
 * current user already can (GMs always can; players can if the Codex's
 * ownership setting grants it); otherwise relays the write through a
 * connected GM's client over Foundry's socket and awaits the result.
 *
 * @returns {Promise<{key:string, page:{uuid:string, name:string}}|null>}
 *   null means the knowledge could not be saved (e.g. no GM online to relay
 *   to) — callers should still show the information to the player, just note
 *   that it wasn't persisted.
 */
export async function requestLearnCategory(actor, categoryId, html, opts = {}) {
  const journal = await getOrCreateJournal();
  if (journal && (await canWriteCodexDirectly(journal))) {
    return learnCategory(actor, categoryId, html, opts);
  }

  const hasConnectedGM = game.users.some((u) => u.isGM && u.active);
  if (!hasConnectedGM) {
    ui.notifications?.warn(
      "Recall Knowledge: no GM is currently online to save this to the Codex. The result is still shown in chat, but won't persist until someone with permission adds it."
    );
    return null;
  }

  const requestId = foundry.utils.randomID();
  const responsePromise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      PENDING_REQUESTS.delete(requestId);
      resolve({ ok: false, error: "timed out waiting for a GM to respond" });
    }, 15000);
    PENDING_REQUESTS.set(requestId, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  game.socket.emit(SOCKET_EVENT, {
    type: "learn-request",
    requestId,
    actorUuid: actor.uuid,
    categoryId,
    html,
    displayName: opts.displayName
  });

  const response = await responsePromise;
  if (!response.ok) {
    ui.notifications?.warn(`Recall Knowledge: couldn't save to the Codex (${response.error ?? "unknown error"}).`);
    return null;
  }
  return { key: response.key, page: { uuid: response.pageUuid, name: response.pageName } };
}

async function canWriteActorDirectly(actor) {
  if (typeof actor.testUserPermission === "function") {
    return actor.testUserPermission(game.user, "OWNER");
  }
  return !!actor.isOwner;
}

/**
 * Permission-aware way to cache a Critical Failure "mistaken identity" onto
 * the target actor (players usually don't have OWNER on NPCs, so this
 * relays through a connected GM the same way requestLearnCategory does).
 * @returns {Promise<boolean>} whether it was actually saved
 */
export async function requestSetMistakenIdentity(actor, mistakenUuid) {
  if (await canWriteActorDirectly(actor)) {
    await actor.setFlag(MODULE_ID, "mistakenIdentity", mistakenUuid);
    return true;
  }

  const hasConnectedGM = game.users.some((u) => u.isGM && u.active);
  if (!hasConnectedGM) return false;

  const requestId = foundry.utils.randomID();
  const responsePromise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      PENDING_REQUESTS.delete(requestId);
      resolve({ ok: false });
    }, 15000);
    PENDING_REQUESTS.set(requestId, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });

  game.socket.emit(SOCKET_EVENT, {
    type: "set-mistaken-request",
    requestId,
    actorUuid: actor.uuid,
    mistakenUuid
  });

  const response = await responsePromise;
  return !!response.ok;
}

/** Open the Codex journal, optionally straight to one creature's page. */
export async function openCodex(actorOrKey) {
  const journal = await getOrCreateJournal();
  if (!journal) return;
  if (!actorOrKey) return journal.sheet.render(true);
  const key = typeof actorOrKey === "string" ? actorOrKey : codexKeyForActor(actorOrKey);
  const page = findPage(journal, key);
  return journal.sheet.render(true, page ? { pageId: page.id } : {});
}
