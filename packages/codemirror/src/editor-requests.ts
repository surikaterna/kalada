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
  readonly settle: () => void;
}

/** One latest request per feature; invalidation also covers environment/view lifetime. */
export class EditorRequests {
  private readonly pending = new Map<RequestKind, AbortController>();
  // Published completion edits remain guarded until supersession, not just settlement.
  private readonly latest = new Map<RequestKind, AbortController>();
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
    this.latest.set(kind, controller);
    const generation = this.generation;
    // Publish ownership before abort listeners can synchronously reenter the registry.
    previous?.abort();
    return {
      snapshot,
      signal: controller.signal,
      settle: () => {
        if (this.pending.get(kind) === controller) this.pending.delete(kind);
      },
      current: () =>
        !controller.signal.aborted &&
        this.latest.get(kind) === controller &&
        generation === this.generation &&
        alive() &&
        sameIdentity(snapshot, current()),
    };
  }

  invalidate(): void {
    this.generation += 1;
    const controllers = [...this.pending.values()];
    this.pending.clear();
    this.latest.clear();
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
  const accept = (result: EditorResult<T> | null): R => {
    // Settled work must not be aborted by publication (which may dispatch or reenter).
    ticket.settle();
    return result && ticket.current() && sameIdentity(result, ticket.snapshot)
      ? publish(result)
      : fallback;
  };
  if (response instanceof Promise)
    return response.then(accept, () => {
      ticket.settle();
      return fallback;
    });
  return accept(response);
}
