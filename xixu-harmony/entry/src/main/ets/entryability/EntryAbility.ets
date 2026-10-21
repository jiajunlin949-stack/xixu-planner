import { UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { setStartupRoute } from '../common/StartupRoute';

export default class EntryAbility extends UIAbility {
  private captureRoute(want: Want): void {
    const route: string = String(want.parameters?.['route'] || '');
    setStartupRoute(route);
  }

  onCreate(want: Want): void { this.captureRoute(want); }

  onNewWant(want: Want): void { this.captureRoute(want); }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    windowStage.loadContent('pages/Index', (error) => {
      if (error.code) { console.error('Xixu page load failed: ' + error.code); }
    });
  }
}
