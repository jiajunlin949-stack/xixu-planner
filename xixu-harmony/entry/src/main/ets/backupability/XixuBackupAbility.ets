import { BackupExtensionAbility, BundleVersion } from '@kit.CoreFileKit';

export default class XixuBackupAbility extends BackupExtensionAbility {
  onBackup(): void {
    // The system copies the whitelisted files after this callback.
  }

  onRestore(_bundleVersion: BundleVersion): void {
    // Data migration is performed by the web data layer after the next launch.
  }
}
