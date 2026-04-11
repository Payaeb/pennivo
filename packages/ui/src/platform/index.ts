import { createElectronPlatform } from './electronPlatform';
import { createCapacitorPlatform } from './capacitorPlatform';
import type { PennivoPlatform } from './platform';

export type { PennivoPlatform, FileTreeEntry } from './platform';

let _platform: PennivoPlatform | null = null;

export function getPlatform(): PennivoPlatform {
  if (!_platform) {
    _platform =
      typeof window !== 'undefined' && window.pennivo
        ? createElectronPlatform()
        : createCapacitorPlatform();
  }
  return _platform;
}
