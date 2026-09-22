export type ImportOutcome = "applied" | "stale";

export class ImportCoordinator<T> {
  private generation = 0;
  private disposed = false;

  invalidate(): void {
    this.generation += 1;
  }

  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }

  async run(
    read: () => Promise<string>,
    parse: (text: string) => T,
    apply: (value: T) => void,
  ): Promise<ImportOutcome> {
    const token = ++this.generation;
    let text: string;
    try {
      text = await read();
    } catch (error) {
      if (!this.current(token)) return "stale";
      throw error;
    }
    if (!this.current(token)) return "stale";
    const value = parse(text);
    if (!this.current(token)) return "stale";
    apply(value);
    return "applied";
  }

  private current(token: number): boolean {
    return !this.disposed && token === this.generation;
  }
}
