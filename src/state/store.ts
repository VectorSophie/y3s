// Minimal observable store base. No framework — just subscribe/emit.

export type Unsubscribe = () => void;

export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected emit(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
}
