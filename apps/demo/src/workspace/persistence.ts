import { type DemoWorkspaceEnvelopeV1, exportWorkspace, importWorkspace } from "./transfer.js";

export const STORAGE_KEY = "kalada-demo-workspace-v1";

export interface PersistenceResult<T = undefined> {
  readonly ok: boolean;
  readonly value?: T;
  readonly code?: string;
}

export function saveWorkspace(storage: Storage, value: DemoWorkspaceEnvelopeV1): PersistenceResult {
  try {
    storage.setItem(STORAGE_KEY, exportWorkspace(value));
    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({ ok: false, code: "PERSISTENCE_UNAVAILABLE" });
  }
}

export function restoreWorkspace(storage: Storage): PersistenceResult<DemoWorkspaceEnvelopeV1> {
  try {
    const text = storage.getItem(STORAGE_KEY);
    if (text === null) return Object.freeze({ ok: false, code: "PERSISTENCE_EMPTY" });
    return Object.freeze({ ok: true, value: importWorkspace(text) });
  } catch {
    return Object.freeze({ ok: false, code: "PERSISTENCE_INVALID" });
  }
}

export function clearWorkspace(storage: Storage): PersistenceResult {
  try {
    storage.removeItem(STORAGE_KEY);
    return Object.freeze({ ok: true });
  } catch {
    return Object.freeze({ ok: false, code: "PERSISTENCE_UNAVAILABLE" });
  }
}
