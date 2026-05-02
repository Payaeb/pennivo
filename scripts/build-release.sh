#!/usr/bin/env bash
# Build a signed Pennivo Android release.
#
# First-time setup: create a file at ~/.pennivo-signing with:
#   export PENNIVO_KEYSTORE_PATH="$HOME/OneDrive/Pennivo/release.keystore"
#   export PENNIVO_KEYSTORE_PASSWORD="your keystore password"
#   export PENNIVO_KEY_ALIAS="pennivo"
#   export PENNIVO_KEY_PASSWORD="your key password"
#
# Then chmod 600 ~/.pennivo-signing so only you can read it.
#
# This script reads those vars, builds AAB (for Play Store) + APK (for
# F-Droid / sideload), prints their sizes, and optionally installs on a
# connected device.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIGNING_FILE="$HOME/.pennivo-signing"
BUILD_TYPE="${1:-both}"  # "aab", "apk", or "both" (default)

echo ""
echo "=== Pennivo Release Build ==="
echo ""

# Load signing credentials
if [ ! -f "$SIGNING_FILE" ]; then
  echo "ERROR: Signing credentials not found at $SIGNING_FILE"
  echo ""
  echo "Create it with the following content (fill in your actual values):"
  echo ""
  echo "  export PENNIVO_KEYSTORE_PATH=\"\$HOME/OneDrive/Pennivo/release.keystore\""
  echo "  export PENNIVO_KEYSTORE_PASSWORD=\"your keystore password\""
  echo "  export PENNIVO_KEY_ALIAS=\"pennivo\""
  echo "  export PENNIVO_KEY_PASSWORD=\"your key password\""
  echo ""
  echo "Then: chmod 600 ~/.pennivo-signing"
  exit 1
fi

# Verify permissions on signing file (warn if world-readable)
if [ "$(stat -c '%a' "$SIGNING_FILE" 2>/dev/null || stat -f '%OLp' "$SIGNING_FILE" 2>/dev/null)" != "600" ]; then
  echo "WARNING: $SIGNING_FILE is not chmod 600. Consider: chmod 600 $SIGNING_FILE"
  echo ""
fi

# shellcheck disable=SC1090
source "$SIGNING_FILE"

# Sanity checks
: "${PENNIVO_KEYSTORE_PATH:?PENNIVO_KEYSTORE_PATH not set in $SIGNING_FILE}"
: "${PENNIVO_KEYSTORE_PASSWORD:?PENNIVO_KEYSTORE_PASSWORD not set}"
: "${PENNIVO_KEY_ALIAS:?PENNIVO_KEY_ALIAS not set}"
: "${PENNIVO_KEY_PASSWORD:?PENNIVO_KEY_PASSWORD not set}"

if [ ! -f "$PENNIVO_KEYSTORE_PATH" ]; then
  echo "ERROR: Keystore not found at $PENNIVO_KEYSTORE_PATH"
  echo "Run: bash scripts/generate-keystore.sh"
  exit 1
fi

echo "Keystore: $PENNIVO_KEYSTORE_PATH"
echo "Alias:    $PENNIVO_KEY_ALIAS"
echo "Target:   $BUILD_TYPE"
echo ""

# Auto-detect JAVA_HOME for Gradle if not already set
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "/c/Program Files/Android/Android Studio/jbr" ]; then
    export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
    echo "JAVA_HOME auto-detected: $JAVA_HOME"
  elif [ -d "/c/Program Files/Java" ]; then
    # Pick the newest JDK under Program Files/Java
    LATEST_JDK=$(ls -d "/c/Program Files/Java/jdk"* 2>/dev/null | sort -V | tail -n1)
    if [ -n "$LATEST_JDK" ]; then
      export JAVA_HOME="$LATEST_JDK"
      echo "JAVA_HOME auto-detected: $JAVA_HOME"
    fi
  fi
fi

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java.exe" ] && [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "ERROR: JAVA_HOME not set and no Java install found."
  echo "Expected: /c/Program Files/Android/Android Studio/jbr (comes with Android Studio)"
  echo "Or install a JDK and set JAVA_HOME in ~/.pennivo-signing"
  exit 1
fi
echo ""

# Build web bundle first (Capacitor needs it copied into android/)
echo "--- Building web bundle ---"
cd "$REPO_ROOT"
pnpm --filter @pennivo/android build

echo ""
echo "--- Syncing Capacitor ---"
cd "$REPO_ROOT/packages/android"
npx cap sync android

echo ""
echo "--- Running Gradle release build ---"
cd "$REPO_ROOT/packages/android/android"

# Export for Gradle
export PENNIVO_KEYSTORE_PATH
export PENNIVO_KEYSTORE_PASSWORD
export PENNIVO_KEY_ALIAS
export PENNIVO_KEY_PASSWORD

case "$BUILD_TYPE" in
  aab)
    ./gradlew bundleRelease
    ;;
  apk)
    ./gradlew assembleRelease
    ;;
  both)
    ./gradlew bundleRelease assembleRelease
    ;;
  *)
    echo "ERROR: Unknown build type '$BUILD_TYPE'. Use: aab | apk | both"
    exit 1
    ;;
esac

echo ""
echo "=== Build complete ==="
echo ""

AAB_PATH="$REPO_ROOT/packages/android/android/app/build/outputs/bundle/release/app-release.aab"
APK_PATH="$REPO_ROOT/packages/android/android/app/build/outputs/apk/release/app-release.apk"

if [ -f "$AAB_PATH" ]; then
  SIZE=$(du -h "$AAB_PATH" | cut -f1)
  echo "AAB: $AAB_PATH ($SIZE)"
fi
if [ -f "$APK_PATH" ]; then
  SIZE=$(du -h "$APK_PATH" | cut -f1)
  echo "APK: $APK_PATH ($SIZE)"
fi

echo ""

# Offer to install on connected device
if [ -f "$APK_PATH" ]; then
  if command -v adb >/dev/null 2>&1; then
    DEVICES=$(adb devices | grep -c "device$" || true)
    if [ "$DEVICES" -gt 0 ]; then
      read -r -p "Install release APK on connected device? [y/N] " INSTALL
      if [ "${INSTALL,,}" = "y" ]; then
        echo ""
        echo "Uninstalling any existing debug build (signatures differ)..."
        adb uninstall app.pennivo.editor 2>/dev/null || true
        echo "Installing release APK..."
        adb install -r "$APK_PATH"
        echo ""
        echo "Launching..."
        adb shell am start -n app.pennivo.editor/.MainActivity
        echo ""
        echo "SMOKE TEST CHECKLIST — tap through these on device:"
        echo "  1. App opens without crashing"
        echo "  2. Type text in editor — works"
        echo "  3. Open command palette, run a command"
        echo "  4. Open settings, change theme"
        echo "  5. Create a new file, save, reopen"
        echo "  6. Insert a mermaid block — renders"
        echo "  7. Insert a table — edit works"
        echo ""
        echo "If any of these fails, it's likely ProGuard stripped something."
      fi
    fi
  fi
fi

echo ""
echo "NEXT STEPS:"
echo "  • Upload AAB to Google Play Console internal track"
echo "  • Test APK on your own device"
echo "  • When happy, promote internal → closed → open → production"
echo ""
