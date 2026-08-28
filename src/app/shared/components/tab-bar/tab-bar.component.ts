import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface TabItem<T extends string = string> {
  value: T;
  label: string;
  panelId?: string;
}

@Component({
  selector: 'app-tab-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'tablist',
    '[attr.aria-label]': 'ariaLabel()',
    '[attr.aria-orientation]': "'horizontal'",
    '[class.sub]': "variant() === 'sub'",
  },
  template: `
    @for (tab of tabs(); track tab.value) {
      <button type="button" class="tab" role="tab"
        [id]="'tab-' + tab.value"
        [attr.aria-selected]="tab.value === selected()"
        [attr.aria-controls]="tab.panelId ?? null"
        [class.active]="tab.value === selected()"
        (click)="select(tab.value)">{{ tab.label }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--sp-xs);
      margin-bottom: 1.25rem;
      background: var(--card);
      border: var(--border-1);
      border-radius: 0.6rem;
      padding: 0.25rem;
      overflow-x: auto;
    }
    :host(.sub) {
      background: var(--bg);
      border-color: transparent;
      margin-top: -0.75rem;
    }
    .tab {
      flex: 1 0 auto;
      min-height: var(--tap);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem;
      border: none;
      background: none;
      border-radius: 0.4rem;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      color: var(--text-muted);
      transition: all 0.15s;
    }
    :host(.sub) .tab { font-size: 0.8rem; }
    .tab:focus-visible { outline-offset: -2px; }
    .tab.active { background: var(--primary); color: white; }
    .tab.active:focus-visible { outline-color: var(--text); }
  `,
})
export class TabBarComponent<T extends string = string> {
  tabs = input.required<readonly TabItem<T>[]>();
  selected = input.required<T>();
  ariaLabel = input.required<string>();
  variant = input<'primary' | 'sub'>('primary');

  selectedChange = output<T>();

  select(value: T): void {
    if (value !== this.selected()) {
      this.selectedChange.emit(value);
    }
  }
}
