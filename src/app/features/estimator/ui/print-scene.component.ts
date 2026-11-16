import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  viewChild,
  viewChildren,
} from '@angular/core';
import { extend, injectBeforeRender, injectStore, NgtArgs, NgtCanvas } from 'angular-three';
import {
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  ShadowMaterial,
} from 'three';
import { OrbitControls, TransformControls } from 'three-stdlib';
import { ModelTransformPatch, PrintSceneBridge, TransformMode } from '../data-access/print-scene-bridge.service';
import { PrintModel } from '../models/print-model.model';

extend({
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrbitControls,
  PlaneGeometry,
  ShadowMaterial,
  TransformControls,
});

/**
 * Scene graph rendered by `angular-three`'s custom renderer. This is where
 * lights, every loaded model and the camera controls live. Instantiated
 * dynamically by `NgtCanvas`, so state comes in/out via `PrintSceneBridge`
 * rather than plain `@Input()`/`@Output()`.
 */
@Component({
  selector: 'app-print-scene-graph',
  standalone: true,
  imports: [NgtArgs],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ngt-ambient-light [intensity]="0.6" />
    <ngt-directional-light
      #dirLightRef
      [position]="[5, 10, 7.5]"
      [intensity]="1.3"
      [castShadow]="true"
    />

    <!-- Printer bed reference grid, sized to the selected printer's largest footprint axis. -->
    <ngt-grid-helper *args="[gridSize(), 22]" [position]="[0, 0, 0]" />

    <!-- Subtle shadow-catcher: fully transparent except where a model's shadow falls on it, so the
         STLs read as physically resting on the printer bed instead of floating over the grid. -->
    <ngt-mesh [rotation]="[-1.5708, 0, 0]" [position]="[0, -0.02, 0]" [receiveShadow]="true">
      <ngt-plane-geometry *args="[gridSize() * 1.5, gridSize() * 1.5]" />
      <ngt-shadow-material [opacity]="0.35" />
    </ngt-mesh>

    <!-- Printable-volume wireframe box, resting on the grid (Y-up: height = printerVolumeMm.y). -->
    <ngt-mesh [position]="[0, bridge.printerVolumeMm().y / 2, 0]">
      <ngt-box-geometry *args="[bridge.printerVolumeMm().x, bridge.printerVolumeMm().y, bridge.printerVolumeMm().z]" />
      <ngt-mesh-basic-material color="#94a3b8" [wireframe]="true" [transparent]="true" [opacity]="0.4" />
    </ngt-mesh>

    <!-- Invisible backdrop: clicking empty bed space deselects the current model.
         Kept raycastable via opacity 0 rather than visible=false (invisible objects are skipped by the raycaster). -->
    <ngt-mesh [rotation]="[-1.5708, 0, 0]" [position]="[0, -0.01, 0]" (click)="bridge.selectModel(null, $event)">
      <ngt-plane-geometry *args="[4000, 4000]" />
      <ngt-mesh-basic-material [transparent]="true" [opacity]="0" [depthWrite]="false" />
    </ngt-mesh>

    <!-- #orbitRef is registered as the NGT store's default controls below (this build's raw-extended
         ngt-orbit-controls has no drei-style makeDefault prop to bind, since that is a soba/drei
         convenience, not a real property on three.js's OrbitControls). -->
    <ngt-orbit-controls #orbitRef *args="[camera(), glDomElement()]" [enableDamping]="true" [dampingFactor]="0.08" />

    <!-- track model.id keeps each mesh's three.js instance stable across re-renders
         (e.g. when another model's transform changes), so NGT only ever patches props
         rather than destroying/recreating siblings. -->
    @for (model of bridge.models(); track model.id) {
      <ngt-mesh
        #meshRef
        [name]="model.id"
        [position]="model.position"
        [rotation]="model.rotation"
        [scale]="model.scale"
        [castShadow]="true"
        [receiveShadow]="true"
        (click)="bridge.selectModel(model.id, $event)"
      >
        <ngt-primitive *args="[model.geometry]" attach="geometry" />
        <ngt-mesh-standard-material
          [color]="isOutOfBounds(model) ? '#ef4444' : '#6366f1'"
          [wireframe]="model.isWireframe || bridge.isWireframe()"
          [roughness]="0.55"
          [metalness]="0.15"
          [side]="doubleSide"
        />
      </ngt-mesh>
    }

    <!-- Gated on a selection so Angular actually destroys (not just hides) the gizmo
         when nothing (or the deleted model) is selected, instead of leaving it dangling. -->
    @if (selectedMeshRef(); as selected) {
      <ngt-transform-controls
        #transformRef
        *args="[camera(), glDomElement()]"
        [mode]="bridge.transformMode()"
        [size]="0.8"
      />
    }
  `,
})
export class PrintSceneGraph {
  protected readonly bridge = inject(PrintSceneBridge);
  protected readonly doubleSide = DoubleSide;

  private readonly store = injectStore();
  protected readonly camera = this.store.select('camera');
  protected readonly glDomElement = this.store.select('gl', 'domElement');

  protected readonly gridSize = () => Math.max(this.bridge.printerVolumeMm().x, this.bridge.printerVolumeMm().z);

  private readonly meshRefs = viewChildren<ElementRef<Mesh>>('meshRef');
  private readonly orbitRef = viewChild<ElementRef<OrbitControls>>('orbitRef');
  private readonly transformRef = viewChild<ElementRef<TransformControls>>('transformRef');
  private readonly dirLightRef = viewChild<ElementRef<DirectionalLight>>('dirLightRef');

  /** The mesh instance matching the currently selected model, found by the `[name]` binding above. */
  protected readonly selectedMeshRef = computed(() => {
    const id = this.bridge.selectedModelId();
    if (!id) return undefined;
    return this.meshRefs().find((ref) => ref.nativeElement.name === id);
  });

  protected isOutOfBounds(model: PrintModel): boolean {
    const v = this.bridge.printerVolumeMm();
    const d = model.baseDimensionsMm;
    const s = model.scale;
    return d.x * s > v.x || d.y * s > v.y || d.z * s > v.z;
  }

  constructor() {
    // Keep OrbitControls' damping smooth every frame.
    injectBeforeRender(() => this.orbitRef()?.nativeElement.update());

    // Registers the orbit rig as the scene's default camera controls (the NGT store's `controls`
    // slot — the same slot drei's `makeDefault` prop writes to), so it's the one instance any
    // other control/raycast-aware code in this scene would coordinate with if added later.
    effect(() => this.store.update({ controls: this.orbitRef()?.nativeElement ?? null }), {
      allowSignalWrites: true,
    });

    // Attach/detach the gizmo to the selected mesh and wire up its native
    // (non-DOM) THREE.js events imperatively, since NGT only forwards the
    // standard pointer/mouse event set.
    effect((onCleanup) => {
      const transform = this.transformRef()?.nativeElement;
      const mesh = this.selectedMeshRef()?.nativeElement;
      const orbit = this.orbitRef()?.nativeElement;
      if (!transform || !mesh) return;

      transform.attach(mesh);
      const modelId = mesh.name;

      // TransformControls dispatches these via THREE's EventDispatcher; its
      // three-stdlib typings only declare the base Object3D event map, so we
      // widen the target to attach/detach the non-standard event names.
      const events = transform as unknown as {
        addEventListener(type: string, listener: (event: { value?: unknown }) => void): void;
        removeEventListener(type: string, listener: (event: { value?: unknown }) => void): void;
      };

      const onDraggingChanged = (event: { value?: unknown }) => {
        if (orbit) orbit.enabled = !event.value;
      };
      const onObjectChange = () => {
        const patch: ModelTransformPatch = {
          id: modelId,
          position: [mesh.position.x, mesh.position.y, mesh.position.z],
          rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
          scale: mesh.scale.x,
        };
        this.bridge.transformRequest.set(patch);
      };

      events.addEventListener('dragging-changed', onDraggingChanged);
      events.addEventListener('objectChange', onObjectChange);

      onCleanup(() => {
        events.removeEventListener('dragging-changed', onDraggingChanged);
        events.removeEventListener('objectChange', onObjectChange);
        transform.detach();
      });
    });

    // Expose the canvas element so the host can capture a PNG snapshot (PDF export).
    effect(() => this.bridge.canvasElement.set(this.glDomElement() ?? null), { allowSignalWrites: true });

    // `shadow.mapSize`/`shadow.camera` are nested THREE.js objects, not bindable from the
    // template, so size the light's shadow frustum imperatively to cover the printer bed.
    effect(() => {
      const light = this.dirLightRef()?.nativeElement;
      if (!light) return;

      const half = this.gridSize();
      light.shadow.mapSize.set(2048, 2048);
      light.shadow.camera.near = 0.5;
      light.shadow.camera.far = 2000;
      light.shadow.camera.left = -half;
      light.shadow.camera.right = half;
      light.shadow.camera.top = half;
      light.shadow.camera.bottom = -half;
      light.shadow.camera.updateProjectionMatrix();
      light.shadow.bias = -0.0005;
    });
  }
}

/** Host component: owns the canvas element, its sizing, and the bridge to the scene graph. */
@Component({
  selector: 'app-print-scene',
  standalone: true,
  imports: [NgtCanvas],
  providers: [PrintSceneBridge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ngt-canvas
      class="block h-full w-full"
      [sceneGraph]="sceneGraph"
      [shadows]="true"
      [camera]="{ position: [150, 150, 200], fov: 50, near: 0.1, far: 5000 }"
      [gl]="{ preserveDrawingBuffer: true }"
      (pointerMissed)="bridge.selectModel(null)"
    />
  `,
})
export class PrintSceneComponent {
  models = input<PrintModel[]>([]);
  selectedModelId = input<string | null>(null);
  printerVolumeMm = input({ x: 220, y: 250, z: 220 });
  transformMode = input<TransformMode>('translate');
  /** Global "X-Ray" override; ORed with each model's own wireframe flag inside the scene graph. */
  isWireframe = input(false);

  modelSelected = output<string | null>();
  modelTransformed = output<ModelTransformPatch>();

  protected readonly sceneGraph = PrintSceneGraph;

  /** `protected` (not `private`) so the template above can call `bridge.selectModel(null)` on `(pointerMissed)`. */
  protected readonly bridge = inject(PrintSceneBridge);

  constructor() {
    // These effects only bridge inputs into the DI-provided service that the
    // dynamically-instantiated scene graph reads from; they don't react to
    // the signals they write, so the write is safe despite NG0600's default
    // restriction.
    effect(() => this.bridge.models.set(this.models()), { allowSignalWrites: true });
    effect(() => this.bridge.selectedModelId.set(this.selectedModelId()), { allowSignalWrites: true });
    effect(() => this.bridge.printerVolumeMm.set(this.printerVolumeMm()), { allowSignalWrites: true });
    effect(() => this.bridge.transformMode.set(this.transformMode()), { allowSignalWrites: true });
    effect(() => this.bridge.isWireframe.set(this.isWireframe()), { allowSignalWrites: true });

    // Reverse direction: the scene graph writes these when the user clicks a
    // mesh/backdrop or drags the gizmo; forward them out as component outputs.
    effect(() => this.modelSelected.emit(this.bridge.selectRequest()));
    effect(() => {
      const patch = this.bridge.transformRequest();
      if (patch) this.modelTransformed.emit(patch);
    });
  }

  /** Captures the current WebGL frame as a PNG data URL for the PDF quote. Requires `preserveDrawingBuffer: true`. */
  captureSnapshot(): string | null {
    return this.bridge.canvasElement()?.toDataURL('image/png', 1.0) ?? null;
  }
}
