import type {
  EditorIdentity,
  EditorRequest,
  EditorResponse,
  EditorResult,
  EditorSnapshot,
} from "./editor-contracts.js";

export type RequestKind = "diagnostics" | "completion" | "hover" | "format";
export interface RequestTicket extends EditorRequest {
  readonly current: () => boolean;
}

/** One latest request per feature; invalidation also covers environment/view lifetime. */
export class EditorRequests {
  private readonly pending = new Map<RequestKind, AbortController>();
  private generation = 0;

  start(
    kind: RequestKind,
    snapshot: EditorSnapshot,
    current: () => EditorSnapshot,
    alive: () => boolean,
  ): RequestTicket {
    const previous = this.pending.get(kind);
    const controller = new AbortController();
    this.pending.set(kind, controller);
    const generation = this.generation;
    // Publish ownership before abort listeners can synchronously reenter the registry.
    previous?.abort();
    return {
      snapshot,
      signal: controller.signal,
      current: () =>
        !controller.signal.aborted &&
        this.pending.get(kind) === controller &&
        generation === this.generation &&
        alive() &&
        sameIdentity(snapshot, current()),
    };
  }

  invalidate(): void {
    this.generation += 1;
    const controllers = [...this.pending.values()];
    this.pending.clear();
    for (const controller of controllers) controller.abort();
  }
}

export function sameIdentity(a: EditorIdentity, b: EditorIdentity): boolean {
  return (
    !!a &&
    a.uri === b.uri &&
    a.version === b.version &&
    a.environmentGeneration === b.environmentGeneration
  );
}

export function resolveResponse<T, R>(
  response: EditorResponse<T>,
  ticket: RequestTicket,
  publish: (result: EditorResult<T>) => R,
  fallback: R,
): R | Promise<R> {
  const accept = (result: EditorResult<T> | null): R =>
    result && ticket.current() && sameIdentity(result, ticket.snapshot)
      ? publish(result)
      : fallback;
  if (response instanceof Promise) return response.then(accept).catch(() => fallback);
  return accept(response);
}
