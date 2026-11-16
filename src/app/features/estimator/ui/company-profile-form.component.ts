import { ChangeDetectionStrategy, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { CompanyProfileStorageService } from '../../../core/services/company-profile-storage.service';

/** Logos are Base64-encoded into LocalStorage, so keep the raw file (and the resulting string) small. */
const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg'];

/** Configuration panel section: B2B branding (name + logo) shown on the generated PDF quote. */
@Component({
  selector: 'app-company-profile-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-3">
      <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Company Profile</h2>

      <div class="flex items-center gap-3">
        @if (logoBase64(); as logo) {
          <img [src]="logo" alt="Company logo" class="h-10 w-10 shrink-0 rounded-lg bg-white/5 object-contain" />
        } @else {
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-[10px] text-neutral-500">
            Logo
          </div>
        }

        <button
          type="button"
          (click)="logoInputRef().nativeElement.click()"
          class="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700"
        >
          Upload Logo
        </button>
        <input
          #logoInput
          type="file"
          accept="image/png,image/jpeg"
          class="hidden"
          (change)="onLogoSelected($event)"
        />
      </div>

      @if (logoError(); as err) {
        <p class="text-[11px] text-red-400">{{ err }}</p>
      }

      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-neutral-400" for="companyName">Company Name</label>
        <input
          id="companyName"
          type="text"
          [value]="name()"
          (input)="onNameInput($any($event.target).value)"
          placeholder="Your Company Name"
          class="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-gray-200 placeholder:text-gray-500"
        />
        <p class="text-[11px] text-gray-500">Shown on the generated PDF quote.</p>
      </div>
    </div>
  `,
})
export class CompanyProfileFormComponent {
  private readonly storage = inject(CompanyProfileStorageService);

  protected readonly logoInputRef = viewChild.required<ElementRef<HTMLInputElement>>('logoInput');

  protected readonly name = signal(this.storage.profile().name);
  protected readonly logoBase64 = signal(this.storage.profile().logoBase64);
  protected readonly logoError = signal<string | null>(null);

  onNameInput(name: string): void {
    this.name.set(name);
    this.persist();
  }

  onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;

    this.logoError.set(null);

    if (!ALLOWED_LOGO_TYPES.includes(file.type)) {
      this.logoError.set('Logo must be a PNG or JPG image.');
      return;
    }
    if (file.size > MAX_LOGO_SIZE_BYTES) {
      this.logoError.set('Logo must be smaller than 2 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.logoBase64.set(reader.result as string);
      this.persist();
    };
    reader.onerror = () => this.logoError.set('Could not read this image file.');
    reader.readAsDataURL(file);
  }

  private persist(): void {
    this.storage.save({ name: this.name(), logoBase64: this.logoBase64() });
  }
}
