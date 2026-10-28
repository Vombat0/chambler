export class Selection {
  private readonly ids = new Set<string>();

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    this.ids.add(id);
  }

  delete(id: string): void {
    this.ids.delete(id);
  }

  clear(): void {
    this.ids.clear();
  }

  toArray(): string[] {
    return Array.from(this.ids);
  }

  get size(): number {
    return this.ids.size;
  }

  /**
   * Click selection semantics.
   * - multi=false: replace selection with {id}.
   * - multi=true: toggle id.
   * - id=null: clear (click on empty).
   */
  click(id: string | null, multi: boolean): void {
    if (id === null) {
      if (!multi) this.ids.clear();
      return;
    }
    if (multi) {
      if (this.ids.has(id)) this.ids.delete(id);
      else this.ids.add(id);
    } else {
      this.ids.clear();
      this.ids.add(id);
    }
  }
}
