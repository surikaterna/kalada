import { type KaladaParseResult, parseKaladaV1Expression } from "@kalada/syntax";
import type { DocumentSnapshot } from "./contracts.js";

// This is an admission budget based on source size, not a measured CST heap allocation.
const MAX_ENTRIES = 64;
const MAX_ESTIMATED_BYTES = 2 * 1024 * 1024;
const ESTIMATE_BASE = 8192;
const ESTIMATE_PER_UTF16_UNIT = 16;

interface Entry {
  readonly document: DocumentSnapshot;
  readonly parsed: KaladaParseResult;
  readonly estimatedBytes: number;
}

export class SyntaxParseCache {
  private readonly entries = new Map<string, Entry>();
  private estimatedBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  get(document: DocumentSnapshot): KaladaParseResult {
    const cached = this.entries.get(document.uri);
    if (cached?.document === document) {
      this.hits += 1;
      return cached.parsed;
    }
    this.misses += 1;
    if (cached) this.forget(document.uri);
    const parsed = parseKaladaV1Expression(document.text);
    const estimatedBytes = ESTIMATE_BASE + document.text.length * ESTIMATE_PER_UTF16_UNIT;
    if (estimatedBytes > MAX_ESTIMATED_BYTES) return parsed;
    while (
      this.entries.size >= MAX_ENTRIES ||
      this.estimatedBytes + estimatedBytes > MAX_ESTIMATED_BYTES
    ) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.forget(oldest);
      this.evictions += 1;
    }
    this.entries.set(document.uri, { document, parsed, estimatedBytes });
    this.estimatedBytes += estimatedBytes;
    return parsed;
  }

  forget(uri: string): void {
    const entry = this.entries.get(uri);
    if (!entry) return;
    this.estimatedBytes -= entry.estimatedBytes;
    this.entries.delete(uri);
  }

  snapshot(): Readonly<{
    entries: number;
    estimatedBytes: number;
    hits: number;
    misses: number;
    evictions: number;
  }> {
    return Object.freeze({
      entries: this.entries.size,
      estimatedBytes: this.estimatedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
    });
  }
}
