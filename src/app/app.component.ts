import { Component } from '@angular/core';
import { EstimatorPageComponent } from './features/estimator/estimator-page.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [EstimatorPageComponent],
  template: `<app-estimator-page />`,
})
export class AppComponent {}
