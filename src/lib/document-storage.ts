import {
  validateDocument,
  type Document,
} from "./document-editor";

export const DOCUMENT_STORAGE_KEY = "apos.document-editor.v1";
export const DOCUMENT_STORAGE_VERSION = 1;

/** ~5 MB cap for the autosaved JSON payload (localStorage safety). */
export const DOCUMENT_STORAGE_MAX_BYTES = 5 * 1024 * 1024;

export type AutoSaveStatus =
  | "idle"
  | "dirty"
  | "saving"
  | "saved"
  | "error"
  | "quota";

export type StorageSlot = {
  version: number;
  savedAt: number;
  document: Document;
};

export type LoadResult =
  | { status: "none" }
  | { status: "ok"; document: Document; savedAt: number }
  | { status: "corrupted"; error: string }
  | { status: "unsupported"; error: string };

export type SaveResult =
  | { ok: true }
  | { ok: false; error: string; quota?: boolean };

function keyLengthBytes(s: string): number {
  return s.length * 2; // UTF-16 storage estimate
}

function payloadBytes(key: string, value: string): number {
  return keyLengthBytes(key) + keyLengthBytes(value);
}

/**
 * Guard that prevents autosave from clobbering a document that was just
 * restored/opened before the user has made a post-restore edit.
 * Returns true if saving is currently blocked.
 */
export function isAutosaveBlocked(options: {
  justRestoredDocumentId: string | null;
  currentDocumentId: string;
  hasPostRestoreEdit: boolean;
}): boolean {
  if (!options.justRestoredDocumentId) return false;
  if (options.currentDocumentId !== options.justRestoredDocumentId) return false;
  return !options.hasPostRestoreEdit;
}

function readStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function serializedByteLength(str: string): number {
  try {
    return new TextEncoder().encode(str).length;
  } catch {
    return str.length * 2;
  }
}

/**
 * Save `document` to localStorage slot.
 * Returns `{ok:false, quota:true}` when payload exceeds {@link DOCUMENT_STORAGE_MAX_BYTES}
 * or the browser quota is hit; corrupt existing data is overwritten safely.
 */
export function saveDocument(document: Document, storageOverride?: Storage): SaveResult {
  try {
    const slot: StorageSlot = {
      version: DOCUMENT_STORAGE_VERSION,
      savedAt: Date.now(),
      document,
    };
    const value = JSON.stringify(slot);
    if (serializedByteLength(value) > DOCUMENT_STORAGE_MAX_BYTES) {
      return { ok: false, error: "Document is too large to autosave in this browser.", quota: true };
    }

    const storage = storageOverride ?? readStorage();
    if (!storage) return { ok: false, error: "Storage is unavailable in this browser." };

    try {
      storage.setItem(DOCUMENT_STORAGE_KEY, value);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : (err as Error)?.name;
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
        return { ok: false, error: "Browser storage is full. Download a backup and clear space.", quota: true };
      }
      return { ok: false, error: err instanceof Error ? err.message : "Autosave failed." };
    }

    // Post-write sanity: payload + key overhead check for tiny quotas.
    if (payloadBytes(DOCUMENT_STORAGE_KEY, value) > DOCUMENT_STORAGE_MAX_BYTES + 16_384) {
      return { ok: false, error: "Document is too large to autosave in this browser.", quota: true };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Autosave failed." };
  }
}

/**
 * Load and validate the autosaved slot.
 * - `none` — no slot yet.
 * - `corrupted` — malformed JSON / invalid Document (safe to clear).
 * - `unsupported` — newer version than this build understands.
 * Version downgrades work because unknown fields are ignored by validateDocument.
 */
export function loadDocument(storageOverride?: Storage): LoadResult {
  const storage = storageOverride ?? readStorage();
  if (!storage) return { status: "none" };

  let raw: string | null;
  try {
    raw = storage.getItem(DOCUMENT_STORAGE_KEY);
  } catch {
    return { status: "none" };
  }
  if (raw === null) return { status: "none" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupted", error: "Autosaved data is corrupted (invalid JSON)." };
  }

  if (parsed === null || typeof parsed !== "object") {
    return { status: "corrupted", error: "Autosaved data is corrupted." };
  }

  const slot = parsed as Record<string, unknown>;
  const version = slot.version;
  if (typeof version !== "number" || !Number.isFinite(version)) {
    return { status: "corrupted", error: "Autosaved data is missing a version." };
  }
  if (version > DOCUMENT_STORAGE_VERSION) {
    return { status: "unsupported", error: `Autosaved version ${version} is newer than supported v${DOCUMENT_STORAGE_VERSION}.` };
  }
  if (!("document" in slot)) {
    return { status: "corrupted", error: "Autosaved data is missing its document." };
  }

  const validated = validateDocument(slot.document);
  if (!validated.ok) return { status: "corrupted", error: validated.error };

  const savedAtRaw = slot.savedAt;
  const savedAt = typeof savedAtRaw === "number" && savedAtRaw > 0 ? savedAtRaw : Date.now();
  return { status: "ok", document: validated.document, savedAt };
}

/** Remove the autosaved slot (used on New / Discard-recovery). */
export function clearDocument(storageOverride?: Storage): void {
  try {
    const storage = storageOverride ?? readStorage();
    storage?.removeItem(DOCUMENT_STORAGE_KEY);
  } catch {
    // Clearing is best-effort.
  }
}
