import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, HostListener, inject, signal, viewChild } from '@angular/core';
import { MathUtils } from 'three';
import {
  CURRENCY_SYMBOLS,
  DEFAULT_MATERIAL_PROFILES,
  DEFAULT_PRINT_CONFIG,
  PRINTER_PROFILES,
  PrintConfig,
} from '../../core/models/print-config.model';
import { CompanyProfileStorageService } from '../../core/services/company-profile-storage.service';
import { MaterialProfileStorageService } from '../../core/services/material-profile-storage.service';
import { FileDropzoneComponent } from '../../shared/ui/file-dropzone.component';
import { StlImportService } from './data-access/stl-import.service';
import { ModelTransformPatch, TransformMode } from './data-access/print-scene-bridge.service';
import { VolumeWorkerService } from './data-access/volume-worker.service';
import { isModelOutOfBounds, PrintModel } from './models/print-model.model';
import { CompanyProfileFormComponent } from './ui/company-profile-form.component';
import { PrintConfigFormComponent } from './ui/print-config-form.component';
import { PrintSceneComponent } from './ui/print-scene.component';

/** Horizontal gap (mm) between successively-loaded models, so they don't spawn stacked on top of each other. */
const SPAWN_SPACING_MM = 120;

/** Maps the UI's per-axis labels onto the tuple index used by `PrintModel.position`/`rotation`. */
const AXIS_INDEX: Record<'x' | 'y' | 'z', 0 | 1 | 2> = { x: 0, y: 1, z: 2 };

/** Smart component: orchestrates the 3D viewport, the outliner, the config form and the pricing signals. */
@Component({
  selector: 'app-estimator-page',
  standalone: true,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    CompanyProfileFormComponent,
    FileDropzoneComponent,
    PrintConfigFormComponent,
    PrintSceneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative h-screen w-screen overflow-hidden bg-neutral-950">
      <!-- Full-screen viewport. The outliner/settings panels float above it, so the scene never has to resize. -->
      <app-print-scene
        #sceneRef
        class="absolute inset-0 z-0 h-screen w-screen"
        [models]="models()"
        [selectedModelId]="selectedModelId()"
        [printerVolumeMm]="printerVolumeMm()"
        [transformMode]="transformMode()"
        [isWireframe]="isWireframe()"
        (modelSelected)="selectedModelId.set($event)"
        (modelTransformed)="onModelTransformed($event)"
      />

      @if (models().length === 0) {
        <div class="absolute inset-0 z-10 flex items-center justify-center p-8">
          <div class="w-full max-w-md">
            <app-file-dropzone (filesSelected)="onFilesSelected($event)" />
          </div>
        </div>
      }

      @if (isLoading()) {
        <div class="absolute left-4 top-4 z-20 rounded-lg bg-neutral-900/80 px-3 py-1.5 text-xs font-medium text-neutral-200 shadow backdrop-blur-md">
          Loading STL...
        </div>
      }

      <!-- Left floating panel: Outliner. -->
      <aside class="absolute left-4 top-4 bottom-4 z-10 flex w-64 flex-col gap-3 overflow-hidden rounded-2xl border border-white/10 bg-neutral-900/80 p-4 text-neutral-200 shadow-2xl backdrop-blur-md">
        <h1 class="text-sm font-semibold text-white">Pro Slicer</h1>

        <app-file-dropzone label="Add STL" [compact]="true" (filesSelected)="onFilesSelected($event)" />

        <div class="flex-1 overflow-y-auto">
          @if (models().length === 0) {
            <p class="mt-2 text-xs text-neutral-500">No models loaded yet.</p>
          } @else {
            <ul class="flex flex-col gap-1">
              @for (model of models(); track model.id) {
                <li
                  (click)="selectedModelId.set(model.id)"
                  class="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs cursor-pointer"
                  [class]="model.id === selectedModelId() ? 'bg-indigo-600/30 ring-1 ring-indigo-500' : 'hover:bg-white/5'"
                >
                  <span class="truncate" [class.text-red-400]="isOutOfBoundsFor(model)">
                    {{ model.name }}
                  </span>
                  <button
                    type="button"
                    (click)="deleteModel(model.id); $event.stopPropagation()"
                    class="shrink-0 rounded p-1 text-neutral-500 hover:bg-red-500/20 hover:text-red-400"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7h12Z" />
                    </svg>
                  </button>
                </li>
              }
            </ul>
          }
        </div>

        @if (models().length > 0) {
          <button
            type="button"
            (click)="clearAll()"
            class="rounded-lg px-2 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10"
          >
            Clear workspace
          </button>
        }
      </aside>

      <!-- Right floating panel: global settings, selected model transform, and quote. -->
      <aside class="absolute right-4 top-4 bottom-4 z-10 flex w-80 flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900/80 p-4 text-neutral-200 shadow-2xl backdrop-blur-md">
        <app-company-profile-form />

        <app-print-config-form (configChange)="config.set($event)" />

        <!-- Global view toggle: forces every model to render as wireframe, regardless of each
             model's own X-Ray checkbox below (which only affects the currently selected model). -->
        <div class="flex flex-col gap-2 border-t border-white/10 pt-4">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">View Settings</h2>
          <label class="flex cursor-pointer items-center justify-between gap-2 text-xs font-medium text-neutral-300">
            <span>Surface Wireframe (X-Ray) · All Models</span>
            <input
              type="checkbox"
              class="peer sr-only"
              [checked]="isWireframe()"
              (change)="isWireframe.set($any($event.target).checked)"
            />
            <span class="relative h-5 w-9 shrink-0 rounded-full bg-neutral-700 transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-4"></span>
          </label>
        </div>

        <div class="flex flex-col gap-3 border-t border-white/10 pt-4">
          <h2 class="text-xs font-semibold uppercase tracking-wide text-neutral-400">Selected Model</h2>

          @if (selectedModel(); as model) {
            <p class="truncate text-sm text-white">{{ model.name }}</p>

            <div class="flex gap-1">
              @for (mode of transformModes; track mode) {
                <button
                  type="button"
                  (click)="transformMode.set(mode)"
                  class="flex-1 rounded-lg px-2 py-1 text-[11px] font-medium capitalize"
                  [class.bg-indigo-600]="transformMode() === mode"
                  [class.text-white]="transformMode() === mode"
                  [class.bg-neutral-800]="transformMode() !== mode"
                  [class.text-neutral-400]="transformMode() !== mode"
                >
                  {{ mode }}
                </button>
              }
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-neutral-400" for="scale">Scale ({{ model.scale | number: '1.2-2' }}x)</label>
              <input
                id="scale"
                type="range"
                min="0.1"
                max="5"
                step="0.01"
                [value]="model.scale"
                (input)="updateSelectedScale(+$any($event.target).value)"
                class="accent-indigo-500"
              />
            </div>

            <label class="flex items-center gap-2 text-xs font-medium text-neutral-400">
              <input
                type="checkbox"
                [checked]="model.isWireframe"
                (change)="updateSelectedWireframe($any($event.target).checked)"
              />
              X-Ray / Wireframe mode
            </label>

            <!-- Precise numeric transform entry. Mirrors (and stays in sync with) whatever the
                 TransformControls gizmo does in the viewport: dragging the gizmo updates the models
                 signal via onModelTransformed, which these inputs read from on every change, and
                 typing here writes back through that same models signal the gizmo relies on. -->
            <div class="flex flex-col gap-2 rounded-xl bg-neutral-800/60 p-3">
              <h3 class="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Transform</h3>

              <div class="grid grid-cols-[3rem_repeat(3,1fr)] items-center gap-1">
                <span></span>
                @for (axis of axes; track axis) {
                  <span class="text-center text-[10px] uppercase text-neutral-500">{{ axis }}</span>
                }
              </div>

              <div class="grid grid-cols-[3rem_repeat(3,1fr)] items-center gap-1">
                <label class="text-[11px] text-neutral-400">Pos (mm)</label>
                @for (axis of axes; track axis) {
                  <input
                    type="number"
                    step="1"
                    [value]="axisValue(model, 'position', axis) | number: '1.0-2'"
                    (change)="updateSelectedTransform('position', axis, +$any($event.target).value)"
                    class="w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[11px] text-gray-200"
                  />
                }
              </div>

              <div class="grid grid-cols-[3rem_repeat(3,1fr)] items-center gap-1">
                <label class="text-[11px] text-neutral-400">Rot (°)</label>
                @for (axis of axes; track axis) {
                  <input
                    type="number"
                    step="1"
                    [value]="axisValue(model, 'rotation', axis) | number: '1.0-1'"
                    (change)="updateSelectedTransform('rotation', axis, +$any($event.target).value)"
                    class="w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[11px] text-gray-200"
                  />
                }
              </div>

              <div class="grid grid-cols-[3rem_repeat(3,1fr)] items-center gap-1">
                <label class="text-[11px] text-neutral-400">Scale</label>
                @for (axis of axes; track axis) {
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    [value]="model.scale | number: '1.2-2'"
                    (change)="updateSelectedScale(+$any($event.target).value)"
                    class="w-full min-w-0 rounded-md border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-[11px] text-gray-200"
                  />
                }
              </div>
              <p class="text-[11px] text-gray-500">Scale is uniform — editing any axis resizes the model on all three.</p>
            </div>

            <div class="flex flex-col gap-1 rounded-xl bg-neutral-800/60 p-3">
              <div class="flex justify-between text-xs text-neutral-400">
                <span>Dimensions</span>
                <span>
                  @if (dimensionsFor(model); as d) {
                    {{ d.x | number: '1.0-1' }} × {{ d.y | number: '1.0-1' }} × {{ d.z | number: '1.0-1' }} mm
                  }
                </span>
              </div>
              <div class="flex justify-between text-xs text-neutral-400">
                <span>Volume</span>
                <span>{{ volumeFor(model) | number: '1.2-2' }} cm³</span>
              </div>
              <div class="flex justify-between text-xs text-neutral-400">
                <span>Weight</span>
                <span>{{ weightFor(model) | number: '1.1-1' }} g</span>
              </div>
            </div>

            @if (isOutOfBoundsFor(model)) {
              <div class="rounded-lg bg-red-600/80 px-3 py-2 text-center text-xs font-semibold text-white">
                Warning: Object exceeds print volume
              </div>
            }
          } @else {
            <p class="text-xs text-neutral-500">Select a model in the viewport or outliner.</p>
          }
        </div>

        <!-- priceFlash() briefly swaps these to the indigo accent whenever infill changes
             (see the effect in the constructor), as a visual cue that the Infill slider is a
             pricing/weight modifier only — it does not alter the hollow STL geometry in the viewport. -->
        <div class="mt-auto flex flex-col gap-2 rounded-xl bg-neutral-800/60 p-4">
          <div class="flex justify-between text-sm transition-colors duration-300" [class.text-neutral-400]="!priceFlash()" [class.text-indigo-400]="priceFlash()">
            <span>Total weight</span>
            <span>{{ totalWeight() | number: '1.1-1' }} g</span>
          </div>
          <div
            class="flex justify-between border-t pt-2 text-base font-semibold transition-colors duration-300"
            [class]="priceFlash() ? 'border-indigo-500/40' : 'border-white/10'"
            [class.text-white]="!priceFlash()"
            [class.text-indigo-400]="priceFlash()"
          >
            <span>Total price</span>
            <span>{{ totalPrice() | currency: config().currency : currencySymbol() : '1.2-2' }}</span>
          </div>
        </div>

        @if (models().length > 0) {
          <button
            type="button"
            (click)="generateQuote()"
            class="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Generate Quote (PDF)
          </button>
        }
      </aside>
    </div>
  `,
})
export class EstimatorPageComponent {
  private readonly stlImport = inject(StlImportService);
  private readonly volumeWorker = inject(VolumeWorkerService);
  private readonly materialProfileStorage = inject(MaterialProfileStorageService);
  private readonly companyProfileStorage = inject(CompanyProfileStorageService);

  private readonly sceneRef = viewChild.required<PrintSceneComponent>('sceneRef');

  protected readonly transformModes: TransformMode[] = ['translate', 'rotate', 'scale'];
  protected readonly axes: Array<'x' | 'y' | 'z'> = ['x', 'y', 'z'];

  readonly models = signal<PrintModel[]>([]);
  readonly selectedModelId = signal<string | null>(null);
  readonly transformMode = signal<TransformMode>('translate');
  readonly isLoading = signal(false);
  readonly config = signal<PrintConfig>(DEFAULT_PRINT_CONFIG);
  /** Global "X-Ray" override shown in View Settings; ORed with each model's own wireframe flag in the scene. */
  readonly isWireframe = signal(false);
  /** Holds a copy of the last cut/copied model (geometry included) for a subsequent Paste. */
  readonly clipboardModel = signal<PrintModel | null>(null);
  /** Briefly true right after the Infill slider changes, so Total weight/price flash to reinforce that infill is a pricing modifier, not a viewport change. */
  readonly priceFlash = signal(false);
  private lastInfillPercent = DEFAULT_PRINT_CONFIG.infillPercent;
  private priceFlashTimeout: ReturnType<typeof setTimeout> | undefined;

  readonly selectedModel = computed(() => this.models().find((m) => m.id === this.selectedModelId()) ?? null);

  readonly printerVolumeMm = computed(() => {
    const printer = PRINTER_PROFILES.find((p) => p.id === this.config().printerProfileId);
    return printer?.sizeMm ?? PRINTER_PROFILES[0].sizeMm;
  });

  readonly materialProfileName = computed(() => {
    const profiles = [...DEFAULT_MATERIAL_PROFILES, ...this.materialProfileStorage.loadCustom()];
    return profiles.find((p) => p.id === this.config().materialProfileId)?.name ?? 'Custom';
  });

  readonly currencySymbol = computed(() => CURRENCY_SYMBOLS[this.config().currency]);

  readonly totalWeight = computed(() => this.models().reduce((sum, m) => sum + this.weightFor(m), 0));
  readonly totalPrice = computed(() => (this.totalWeight() / 1000) * this.config().costPerKg);

  constructor() {
    // Infill has no effect on the (hollow) STL geometry shown in the viewport — it only feeds
    // the weight/price math — so flashing the totals is the only visible feedback a user gets
    // that dragging the slider actually did something.
    effect(() => {
      const infillPercent = this.config().infillPercent;
      if (infillPercent === this.lastInfillPercent) return;
      this.lastInfillPercent = infillPercent;

      this.priceFlash.set(true);
      clearTimeout(this.priceFlashTimeout);
      this.priceFlashTimeout = setTimeout(() => this.priceFlash.set(false), 600);
    }, { allowSignalWrites: true });
  }

  protected dimensionsFor(model: PrintModel): { x: number; y: number; z: number } {
    const d = model.baseDimensionsMm;
    return { x: d.x * model.scale, y: d.y * model.scale, z: d.z * model.scale };
  }

  protected volumeFor(model: PrintModel): number {
    return model.baseVolumeCm3 * Math.pow(model.scale, 3);
  }

  protected weightFor(model: PrintModel): number {
    const { densityGCm3, infillPercent } = this.config();
    const infillFactor = Math.min(Math.max(infillPercent, 0), 100) / 100;
    return this.volumeFor(model) * densityGCm3 * infillFactor;
  }

  protected isOutOfBoundsFor(model: PrintModel): boolean {
    return isModelOutOfBounds(model, this.printerVolumeMm());
  }

  protected priceFor(model: PrintModel): number {
    return (this.weightFor(model) / 1000) * this.config().costPerKg;
  }

  /** Reads one axis of a model's position/rotation for the numeric Transform inputs, converting rotation to degrees for display. */
  protected axisValue(model: PrintModel, property: 'position' | 'rotation', axis: 'x' | 'y' | 'z'): number {
    const raw = model[property][AXIS_INDEX[axis]];
    return property === 'rotation' ? MathUtils.radToDeg(raw) : raw;
  }

  /** Writes a single typed axis value back into the selected model's position/rotation tuple, converting rotation degrees to radians. */
  protected updateSelectedTransform(property: 'position' | 'rotation', axis: 'x' | 'y' | 'z', value: number): void {
    const id = this.selectedModelId();
    if (!id) return;

    const index = AXIS_INDEX[axis];
    const resolved = property === 'rotation' ? MathUtils.degToRad(value) : value;

    this.models.update((models) =>
      models.map((m) => {
        if (m.id !== id) return m;
        const next = [...m[property]] as [number, number, number];
        next[index] = resolved;
        return { ...m, [property]: next };
      }),
    );
  }

  /**
   * Desktop-style clipboard shortcuts for the selected model. Bound on `window` (rather than the
   * viewport element) so they fire regardless of which part of the layout currently has focus,
   * except while the user is typing into a form field.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA'].includes(target.tagName)) return;

    const isModifierPressed = event.ctrlKey || event.metaKey;

    if (event.key === 'Delete' || event.key === 'Backspace') {
      const id = this.selectedModelId();
      if (!id) return;
      // Backspace would otherwise navigate the browser back when nothing has DOM focus.
      event.preventDefault();
      this.deleteModel(id);
      this.focusCanvas();
      return;
    }

    if (!isModifierPressed) return;

    if (event.key === 'c' || event.key === 'C') {
      if (!this.selectedModel()) return;
      event.preventDefault(); // blocks the browser's native copy (would try to copy any page text selection).
      this.copySelected();
      this.focusCanvas();
    } else if (event.key === 'x' || event.key === 'X') {
      const id = this.selectedModelId();
      if (!id) return;
      event.preventDefault();
      this.copySelected();
      this.deleteModel(id);
      this.focusCanvas();
    } else if (event.key === 'v' || event.key === 'V') {
      if (!this.clipboardModel()) return;
      event.preventDefault(); // blocks the browser's native paste.
      this.pasteClipboard();
      this.focusCanvas();
    }
  }

  private copySelected(): void {
    const model = this.selectedModel();
    if (model) this.clipboardModel.set(model);
  }

  private pasteClipboard(): void {
    const clipboard = this.clipboardModel();
    if (!clipboard) return;

    const [x, y, z] = clipboard.position;
    const pasted: PrintModel = {
      ...clipboard,
      id: crypto.randomUUID(),
      // Clone the BufferGeometry so the duplicate owns its own GPU buffers — otherwise
      // deleting either copy would dispose() the shared geometry out from under the other.
      geometry: clipboard.geometry.clone(),
      position: [x + 20, y, z + 20],
    };

    this.models.update((models) => [...models, pasted]);
    this.selectedModelId.set(pasted.id);
  }

  /**
   * Keyboard shortcuts (Copy/Cut/Paste/Delete) run while DOM focus is wherever the user last
   * clicked, not necessarily the canvas — and native clipboard actions can shift focus to the
   * browser chrome entirely. NGT only raycasts pointer events against a focused-and-listening
   * canvas, so the very next mesh click after a shortcut would otherwise silently miss until the
   * user clicks empty bed space first. Canvases have no implicit tabindex, so one is set here
   * (-1: programmatically focusable, but excluded from normal Tab order) before focusing it back.
   * Deferred one tick via setTimeout so this runs after the current change detection cycle (model
   * add/remove, selection change) has applied.
   */
  private focusCanvas(): void {
    setTimeout(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      canvas.tabIndex = -1;
      canvas.focus({ preventScroll: true });
    }, 0);
  }

  async onFilesSelected(files: File[]): Promise<void> {
    this.isLoading.set(true);

    // Each file gets its own try/catch rather than one around the whole loop: a single
    // malformed/corrupted STL (failing either at parse time or inside the volume worker's
    // math) must not abort the rest of the batch, and must never hang the "Loading STL..."
    // indicator — the model is only ever pushed into `models()` after every step below
    // succeeds, so a failure here means there's nothing left to roll back.
    for (const file of files) {
      try {
        const { geometry, size } = await this.stlImport.loadFile(file);
        const baseVolumeCm3 = await this.volumeWorker.calculateVolumeCm3(geometry);

        const model: PrintModel = {
          id: crypto.randomUUID(),
          name: file.name,
          geometry,
          scale: 1,
          position: [this.models().length * SPAWN_SPACING_MM, 0, 0],
          rotation: [0, 0, 0],
          isWireframe: false,
          baseVolumeCm3,
          baseDimensionsMm: size,
        };

        this.models.update((models) => [...models, model]);
        this.selectedModelId.set(model.id);
      } catch {
        alert(`"${file.name}" could not be loaded: malformed or corrupted STL file.`);
      }
    }

    this.isLoading.set(false);
  }

  deleteModel(id: string): void {
    // Clear the selection first so TransformControls detaches from the live mesh (see the effect
    // in PrintSceneGraph's constructor) before that mesh is removed from `models()` underneath it.
    if (this.selectedModelId() === id) this.selectedModelId.set(null);

    const model = this.models().find((m) => m.id === id);
    model?.geometry.dispose();
    this.models.update((models) => models.filter((m) => m.id !== id));
  }

  /** Frees every loaded mesh's GPU buffers and resets the workspace to its empty state. */
  clearAll(): void {
    this.models().forEach((m) => m.geometry.dispose());
    this.models.set([]);
    this.selectedModelId.set(null);
  }

  updateSelectedScale(scale: number): void {
    this.patchSelected({ scale });
  }

  updateSelectedWireframe(isWireframe: boolean): void {
    this.patchSelected({ isWireframe });
  }

  /** Applied when the TransformControls gizmo is dragged in the scene. */
  onModelTransformed(patch: ModelTransformPatch): void {
    this.models.update((models) =>
      models.map((m) => (m.id === patch.id ? { ...m, position: patch.position, rotation: patch.rotation, scale: patch.scale } : m)),
    );
  }

  private patchSelected(patch: Partial<PrintModel>): void {
    const id = this.selectedModelId();
    if (!id) return;
    this.models.update((models) => models.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  /**
   * Builds a one-page B2B PDF quote: company logo/name header, dynamic quote date,
   * a viewport snapshot (`renderer.domElement.toDataURL`, captured via the bridge), and
   * an itemized list of every model with its individual price plus the grand total.
   */
  async generateQuote(): Promise<void> {
    const snapshot = this.sceneRef().captureSnapshot();
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    const company = this.companyProfileStorage.profile();
    const hasLogo = !!company.logoBase64;
    const headerTextX = hasLogo ? 112 : 40;

    if (company.logoBase64) {
      try {
        doc.addImage(company.logoBase64, 40, 36, 56, 56);
      } catch {
        // Corrupt/unsupported image data shouldn't block the rest of the export.
      }
    }

    doc.setFontSize(16);
    doc.text(company.name || 'Print Quote', headerTextX, 58);
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text(`Quote Date: ${new Date().toLocaleDateString()}`, headerTextX, 74);
    doc.setTextColor(0);

    let y = 130;

    if (snapshot) {
      doc.addImage(snapshot, 'PNG', 40, y, 300, 225);
      y += 245;
    }

    doc.setFontSize(11);
    doc.text(`Material: ${this.materialProfileName()}  •  Infill: ${this.config().infillPercent}%`, 40, y);
    y += 24;

    for (const model of this.models()) {
      const d = this.dimensionsFor(model);
      const line = `${model.name} — ${d.x.toFixed(1)}×${d.y.toFixed(1)}×${d.z.toFixed(1)} mm, ${model.scale.toFixed(2)}x, ${this.weightFor(model).toFixed(1)} g`;
      const itemPrice = `${this.currencySymbol()}${this.priceFor(model).toFixed(2)}`;
      doc.text(line, 40, y);
      doc.text(itemPrice, 500, y, { align: 'right' });
      y += 18;
    }

    doc.setFontSize(14);
    const total = `${this.currencySymbol()}${this.totalPrice().toFixed(2)}`;
    doc.text(`Estimated Total: ${total}`, 40, y + 16);

    doc.save(`quote-${this.models().length}-models.pdf`);
  }
}
