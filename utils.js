export const MODULE_ID = "spider-vibes";

export function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function slugify(s) {
  return (s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Strip HTML down to plain text (used to summarize long ability descriptions). */
export function stripHtmlToText(html, maxLen = 99999) {
  let text;
  try {
    text = new DOMParser().parseFromString(html ?? "", "text/html").body.textContent || "";
  } catch (_err) {
    text = String(html ?? "").replace(/<[^>]+>/g, "");
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed;
}

/**
 * Per GM Core's own guidance, a successful Recall Knowledge check reveals
 * truthful information but not exact numbers. This strips standalone digit
 * runs (damage values, DCs, ranges, etc.) out of free text pulled from an
 * ability's rules text, so descriptions stay qualitative. It's a blunt
 * instrument — grammar can get slightly awkward ("within feet") — but it
 * reliably keeps raw statblock numbers from leaking into what players see.
 */
export function stripNumbers(text) {
  return (text ?? "")
    .replace(/\d+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .trim();
}

/** Foundry has been migrating v1 helpers into `foundry.applications.*` namespaces
 *  across the v12-14 release cycle but keeps back-compat globals for now. These
 *  small getters prefer the new path when present and fall back to the global. */
export function getRenderTemplate() {
  return foundry?.applications?.handlebars?.renderTemplate ?? globalThis.renderTemplate;
}
export function getFormDataExtended() {
  return foundry?.applications?.ux?.FormDataExtended ?? globalThis.FormDataExtended;
}
export function getTextEditor() {
  return foundry?.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

/** Dialog (v1) callbacks have historically received a jQuery-wrapped element.
 *  Unwrap defensively in case a future core version passes a raw HTMLElement. */
export function root(html) {
  if (!html) return null;
  if (html.jquery) return html[0];
  if (html instanceof HTMLElement) return html;
  return html[0] ?? html;
}

/** Render a clickable content-link to a document (e.g. a Codex journal page). */
export async function enrichUuidLink(uuid, label) {
  const TextEditor = getTextEditor();
  return TextEditor.enrichHTML(`@UUID[${uuid}]{${label}}`, { async: true });
}
