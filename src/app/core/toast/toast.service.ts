import { Injectable, signal } from '@angular/core';

export interface Toast {
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly current = signal<Toast | null>(null);
  private timeout: ReturnType<typeof setTimeout> | null = null;

  readonly toast = this.current.asReadonly();

  show(message: string, durationMs = 3000): void {
    this.current.set({ message });
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => this.current.set(null), durationMs);
  }
}
