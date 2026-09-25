import type { CompositionMeter, CompositionRequest } from "./contracts.js";

export class Meter implements CompositionMeter {
  work = 0;
  depth = 0;
  diagnostics = 0;
  exhausted = false;
  private active = 0;
  private readonly limits: CompositionRequest["limits"];
  constructor(limits: CompositionRequest["limits"]) {
    this.limits = limits;
  }
  private debit(key: "work" | "diagnostics", amount: number, limit: number): boolean {
    if (
      this.exhausted ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      this[key] + amount > limit
    ) {
      this.exhausted = true;
      return false;
    }
    this[key] += amount;
    return true;
  }
  charge(units: number): boolean {
    return this.debit("work", units, this.limits.work);
  }
  report(count: number): boolean {
    return this.debit("diagnostics", count, this.limits.diagnostics);
  }
  enter(): boolean {
    if (this.exhausted || this.active >= this.limits.depth) {
      this.exhausted = true;
      return false;
    }
    this.active++;
    this.depth = Math.max(this.depth, this.active);
    return true;
  }
  leave(): void {
    this.active--;
  }
}
