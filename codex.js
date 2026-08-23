import { MODULE_ID, slugify } from "./utils.js";
import { CATEGORIES } from "./categories.js";

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
      name: game.settings.get(MODULE_ID, "codexJournalName") || "Recall Knowledge Codex",
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

    if (payload.type === "learn-request") {
      // Only one connected GM should act on a given request. `activeGM` (when
      // available) picks a single canonical GM; otherwise every GM client
      // would try to process the same request redundantly.
      const canonicalGmId = game.users.activeGM?.id;
      const isResponsible = game.user.isGM && (!canonicalGmId || canonicalGmId === game.user.id);
      if (!isResponsible) return;

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
        console.error("Recall Knowledge | GM relay failed to record Codex knowledge", err);
        game.socket.emit(SOCKET_EVENT, {
          type: "learn-response",
          requestId: payload.requestId,
          ok: false,
          error: String(err?.message ?? err)
        });
      }
      return;
    }

    if (payload.type === "learn-response") {
      const resolvePending = PENDING_REQUESTS.get(payload.requestId);
      if (resolvePending) {
        PENDING_REQUESTS.delete(payload.requestId);
        resolvePending(payload);
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

/** Open the Codex journal, optionally straight to one creature's page. */
export async function openCodex(actorOrKey) {
  const journal = await getOrCreateJournal();
  if (!journal) return;
  if (!actorOrKey) return journal.sheet.render(true);
  const key = typeof actorOrKey === "string" ? actorOrKey : codexKeyForActor(actorOrKey);
  const page = findPage(journal, key);
  return journal.sheet.render(true, page ? { pageId: page.id } : {});
}
