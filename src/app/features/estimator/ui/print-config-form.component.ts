import { ChangeDetectionStrategy, Component, effect, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINT_CONFIG,
  MaterialProfile,
  PRINTER_PROFILES,
  PrintConfig,
} from '../../../core/models/print-config.model';
import { PrintConfigStorageService } from '../../../core/services/print-config-storage.service';
import { MaterialProfileStorageService } from '../../../core/services/material-profile-storage.service';

/** Dumb-ish configuration panel: owns its form + persistence, emits valid config snapshots. */
@Component({
  selector: 'app-print-config-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="materialProfileId">Material Profile</label>
        <select
          id="materialProfileId"
          formControlName="materialProfileId"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200"
        >
          @for (profile of profiles(); track profile.id) {
            <option [value]="profile.id">{{ profile.name }}</option>
          }
        </select>
        <p class="text-[11px] text-gray-500">Selecting a profile fills density, cost and currency below.</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="densityGCm3">Density (g/cm³)</label>
        <input
          id="densityGCm3"
          type="number"
          step="0.01"
          min="0.01"
          formControlName="densityGCm3"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200"
        />
        <p class="text-[11px] text-gray-500">Material specific weight, e.g. PLA is ~1.24 g/cm³.</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="costPerKg">Cost per KG</label>
        <input
          id="costPerKg"
          type="number"
          step="0.1"
          min="0"
          formControlName="costPerKg"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200"
        />
        <p class="text-[11px] text-gray-500">Price you pay per kilogram of this filament spool.</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="currency">Currency</label>
        <select
          id="currency"
          formControlName="currency"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200"
        >
          <option value="USD">USD ($)</option>
          <option value="EUR">EUR (€)</option>
          <option value="GBP">GBP (£)</option>
          <option value="ARS">ARS (AR$)</option>
          <option value="BRL">BRL (R$)</option>
          <option value="MXN">MXN (Mex$)</option>
        </select>
        <p class="text-[11px] text-gray-500">Currency used to display the final price estimate.</p>
      </div>

      <div class="flex gap-2">
        <input
          #newProfileNameInput
          type="text"
          placeholder="New profile name"
          class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
        />
        <button
          type="button"
          (click)="saveCurrentAsProfile(newProfileNameInput.value); newProfileNameInput.value = ''"
          class="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500"
        >
          Save Profile
        </button>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="printerProfileId">Printer Profile</label>
        <select
          id="printerProfileId"
          formControlName="printerProfileId"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200"
        >
          @for (printer of printerProfiles; track printer.id) {
            <option [value]="printer.id">{{ printer.name }}</option>
          }
        </select>
        <p class="text-[11px] text-gray-500">Your printer's build volume, shown as a wireframe box in the viewport.</p>
      </div>

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-gray-400" for="infillPercent">
          Infill ({{ form.controls.infillPercent.value }}%)
        </label>
        <input
          id="infillPercent"
          type="range"
          min="0"
          max="100"
          step="1"
          formControlName="infillPercent"
          class="accent-indigo-500"
        />
        <p class="text-[11px] text-gray-500">
          Modifies estimated weight and material cost. (STLs are hollow surface meshes — the viewport
          always shows just the outer shell, not this internal density.)
        </p>
      </div>
    </form>
  `,
})
export class PrintConfigFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly storage = inject(PrintConfigStorageService);
  private readonly materialProfileStorage = inject(MaterialProfileStorageService);

  configChange = output<PrintConfig>();

  protected readonly printerProfiles = PRINTER_PROFILES;

  /** Built-in defaults merged with any user-saved custom profiles. */
  protected readonly profiles = signal<MaterialProfile[]>([
    ...DEFAULT_MATERIAL_PROFILES,
    ...this.materialProfileStorage.loadCustom(),
  ]);

  readonly form = this.fb.group({
    materialProfileId: this.fb.control(DEFAULT_PRINT_CONFIG.materialProfileId, { nonNullable: true }),
    densityGCm3: this.fb.control(DEFAULT_PRINT_CONFIG.densityGCm3, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0.01)],
    }),
    costPerKg: this.fb.control(DEFAULT_PRINT_CONFIG.costPerKg, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0)],
    }),
    currency: this.fb.control(DEFAULT_PRINT_CONFIG.currency, { nonNullable: true }),
    infillPercent: this.fb.control(DEFAULT_PRINT_CONFIG.infillPercent, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(0), Validators.max(100)],
    }),
    printerProfileId: this.fb.control(DEFAULT_PRINT_CONFIG.printerProfileId, { nonNullable: true }),
  });

  /** Synchronous signal view of the form, used by the `effect` below. */
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  constructor() {
    const saved = this.storage.load();
    if (saved) this.form.patchValue(saved);

    // Auto-fill density/cost/currency when the material profile changes, without fighting manual edits.
    this.form.controls.materialProfileId.valueChanges.pipe(takeUntilDestroyed()).subscribe((profileId) => {
      const profile = this.profiles().find((p) => p.id === profileId);
      if (!profile) return;
      this.form.patchValue({
        densityGCm3: profile.densityGCm3,
        costPerKg: profile.costPerKg,
        currency: profile.currency,
      });
    });

    effect(() => {
      if (this.form.invalid) return;
      const value = this.formValue() as PrintConfig;
      this.storage.save(value);
      this.configChange.emit(value);
    });
  }

  /** Saves the form's current density/cost/currency as a new named, selectable, persisted material profile. */
  saveCurrentAsProfile(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;

    const { densityGCm3, costPerKg, currency } = this.form.getRawValue();
    const newProfile: MaterialProfile = { id: crypto.randomUUID(), name: trimmed, densityGCm3, costPerKg, currency };

    const customProfiles = [...this.materialProfileStorage.loadCustom(), newProfile];
    this.materialProfileStorage.saveCustom(customProfiles);
    this.profiles.set([...DEFAULT_MATERIAL_PROFILES, ...customProfiles]);
    this.form.controls.materialProfileId.setValue(newProfile.id);
  }
}
