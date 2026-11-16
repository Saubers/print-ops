import { ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

/** Hard ceiling on a single uploaded STL, so a huge/malicious file can't exhaust the tab's memory while parsing. */
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Presentation-only drag & drop + click-to-browse surface. Accepts one or many .stl files at once. */
@Component({
  selector: 'app-file-dropzone',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed transition-colors cursor-pointer"
      [class.p-6]="!compact()"
      [class.p-3]="compact()"
      [class]="isDragOver() ? 'border-indigo-400 bg-indigo-500/10' : 'border-neutral-700 hover:border-neutral-600'"
      (click)="fileInputRef().nativeElement.click()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave()"
      (drop)="onDrop($event)"
    >
      <span class="text-center text-xs font-medium text-gray-300">
        {{ label() }}
      </span>
      @if (!compact()) {
        <span class="text-[11px] text-gray-500">.stl files only, multiple allowed</span>
      }
      <input
        #fileInput
        type="file"
        accept=".stl"
        multiple
        class="hidden"
        (change)="onFileInputChange($event)"
      />
    </div>
  `,
})
export class FileDropzoneComponent {
  label = input('Drag & drop .stl files, or click to browse');
  /** Smaller padding/no helper text, for use inside the floating outliner panel. */
  compact = input(false);

  filesSelected = output<File[]>();

  isDragOver = signal(false);

  protected readonly fileInputRef = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(): void {
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    const files = Array.from(event.dataTransfer?.files ?? []);
    this.processFiles(files);
  }

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    this.processFiles(files);
  }

  /**
   * Rejects wrong-extension and oversized files before they ever reach the STL parser/volume
   * worker. The `accept=".stl"` attribute on the file input only filters the native browser
   * picker — it does nothing for drag & drop, so the extension check below is the only real
   * gate against a user (accidentally or otherwise) dropping an arbitrary file.
   */
  private processFiles(files: File[]): void {
    const validFiles: File[] = [];
    const wrongExtensionNames: string[] = [];
    const oversizedNames: string[] = [];

    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.stl')) {
        wrongExtensionNames.push(file.name);
      } else if (file.size > MAX_FILE_SIZE_BYTES) {
        oversizedNames.push(file.name);
      } else {
        validFiles.push(file);
      }
    }

    if (wrongExtensionNames.length) {
      alert(`Only .stl files are supported. The following file(s) were not loaded:\n${wrongExtensionNames.join('\n')}`);
    }

    if (oversizedNames.length) {
      alert(`File too large. Max 50MB limit to prevent browser memory crashes:\n${oversizedNames.join('\n')}`);
    }

    if (validFiles.length) this.filesSelected.emit(validFiles);
  }
}
