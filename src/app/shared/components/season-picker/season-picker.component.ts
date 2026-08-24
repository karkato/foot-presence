import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Season, isCurrentSeason } from '../../models/season.model';

@Component({
  selector: 'app-season-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (seasons().length > 1) {
      <div class="season-picker">
        <label for="season-select">Saison</label>
        <select
          id="season-select"
          [ngModel]="selectedSeasonId()"
          (ngModelChange)="seasonChange.emit($event)"
        >
          @for (season of seasons(); track season.id) {
            <option [value]="season.id">
              {{ season.name }} {{ isCurrentSeason(season) ? '(en cours)' : '(archivée)' }}
            </option>
          }
        </select>
      </div>
    }
  `,
  styles: `
    .season-picker { display: flex; flex-direction: column; gap: var(--sp-xs); margin-bottom: var(--sp-lg); }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    select {
      width: 100%; min-height: var(--tap); padding: 0.55rem 0.75rem; border: var(--border-1); border-radius: var(--r-md);
      font-size: var(--fs-field); font-weight: 600; background: var(--card); color: var(--text); font-family: inherit;
    }
    select:focus { outline: none; border-color: var(--primary); }
    select:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: 2px;
    }
  `,
})
export class SeasonPickerComponent {
  readonly isCurrentSeason = isCurrentSeason;

  seasons = input.required<Season[]>();
  selectedSeasonId = input<string | null>(null);

  seasonChange = output<string>();
}
