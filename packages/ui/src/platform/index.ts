import { createElectronPlatform } from "./electronPlatform";
import { createCapacitorPlatform } from "./capacitorPlatform";
import { createWebPlatform } from "./webPlatform";
import type { PennivoPlatform } from "./platform";

export type { PennivoPlatform, FileTreeEntry } from "./platform";

let _platform: PennivoPlatform | null = null;

/**
 * Detect whether the renderer is running inside a Capacitor WebView (Android).
 *
 * Capacitor injects a global `Capacitor` object with `isNativePlatform()` and a
 * `getPlatform()` that returns `'android'` / `'ios'` / `'web'`. When the bundle
 * is opened in a regular browser without Capacitor, this global is absent.
 */
function isCapacitorRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: unknown }).Capacitor as
    | { isNativePlatform?: () => boolean; getPlatform?: () => string }
    | undefined;
  if (!cap) return false;
  try {
    if (typeof cap.isNativePlatform === "function") {
      return cap.isNativePlatform();
    }
    if (typeof cap.getPlatform === "function") {
      return cap.getPlatform() !== "web";
    }
  } catch {
    return false;
  }
  return false;
}

export function getPlatform(): PennivoPlatform {
  if (!_platform) {
    if (typeof window !== "undefined" && window.pennivo) {
      _platform = createElectronPlatform();
    } else if (isCapacitorRuntime()) {
      _platform = createCapacitorPlatform();
    } else {
      _platform = createWebPlatform();
    }
  }
  return _platform;
}
