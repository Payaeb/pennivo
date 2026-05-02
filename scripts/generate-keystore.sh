#!/usr/bin/env bash
# Generate the Pennivo release keystore for Android signing.
#
# IMPORTANT: This is a one-time operation. The generated keystore signs
# EVERY future release. Losing it means you can never update the app on
# Google Play — users would have to uninstall and reinstall a new app.
#
# What to do BEFORE running this script:
# 1. Open your password manager (1Password / Bitwarden / etc.)
# 2. Decide on a storage location OUTSIDE this repo. Recommended:
#    $HOME/OneDrive/Pennivo/release.keystore
#    (OneDrive = automatic cloud backup)
# 3. Have a strong passphrase ready (keytool will prompt for it)
#
# Run this script, answer the prompts. The keystore and passwords go
# into your password manager. DO NOT commit the keystore anywhere.

set -euo pipefail

echo ""
echo "=== Pennivo Release Keystore Generator ==="
echo ""
echo "This will create a keystore for signing Android releases."
echo "You'll be prompted for:"
echo "  - A keystore password (store in password manager)"
echo "  - A key password (can be same as keystore password)"
echo "  - Personal info: name, org, city, state, country"
echo ""

# Default location: OneDrive so it's auto-backed-up
DEFAULT_PATH="$HOME/OneDrive/Pennivo/release.keystore"

read -r -p "Keystore output path [$DEFAULT_PATH]: " KEYSTORE_PATH
KEYSTORE_PATH="${KEYSTORE_PATH:-$DEFAULT_PATH}"

# Expand ~ if present
KEYSTORE_PATH="${KEYSTORE_PATH/#\~/$HOME}"

# Ensure directory exists
KEYSTORE_DIR=$(dirname "$KEYSTORE_PATH")
if [ ! -d "$KEYSTORE_DIR" ]; then
  echo "Creating directory: $KEYSTORE_DIR"
  mkdir -p "$KEYSTORE_DIR"
fi

# Safety: bail if keystore already exists at target path
if [ -f "$KEYSTORE_PATH" ]; then
  echo ""
  echo "ERROR: A keystore already exists at $KEYSTORE_PATH"
  echo "Refusing to overwrite — this could destroy your signing key."
  echo ""
  echo "If you really want to regenerate, delete the old one manually first."
  exit 1
fi

# Find keytool (comes with any Java install, including Android Studio's JBR)
KEYTOOL=""
if command -v keytool >/dev/null 2>&1; then
  KEYTOOL="keytool"
elif [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then
  KEYTOOL="$JAVA_HOME/bin/keytool"
elif [ -x "/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe" ]; then
  KEYTOOL="/c/Program Files/Android/Android Studio/jbr/bin/keytool.exe"
else
  echo "ERROR: keytool not found. Install Java JDK or Android Studio (includes JBR)."
  exit 1
fi

echo ""
echo "Using keytool: $KEYTOOL"
echo "Generating keystore at: $KEYSTORE_PATH"
echo ""
echo "keytool will now prompt you for passwords and personal info."
echo "The key alias will be: pennivo"
echo "Validity: 10000 days (~27 years)"
echo ""

"$KEYTOOL" -genkeypair \
  -v \
  -keystore "$KEYSTORE_PATH" \
  -alias pennivo \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

echo ""
echo "=== Done ==="
echo ""
echo "Keystore created: $KEYSTORE_PATH"
echo ""
echo "NEXT STEPS:"
echo "1. Save these values in your password manager:"
echo "   - Keystore file location (and back it up — OneDrive/iCloud/etc.)"
echo "   - Keystore password"
echo "   - Key alias: pennivo"
echo "   - Key password"
echo ""
echo "2. Set environment variables for Gradle release builds:"
echo "   export PENNIVO_KEYSTORE_PATH=\"$KEYSTORE_PATH\""
echo "   export PENNIVO_KEYSTORE_PASSWORD=\"<your keystore password>\""
echo "   export PENNIVO_KEY_ALIAS=\"pennivo\""
echo "   export PENNIVO_KEY_PASSWORD=\"<your key password>\""
echo ""
echo "3. Build a signed release:"
echo "   cd packages/android/android"
echo "   ./gradlew bundleRelease   # AAB for Google Play"
echo "   ./gradlew assembleRelease # APK for F-Droid / sideload"
echo ""
echo "4. Verify the keystore:"
echo "   $KEYTOOL -list -v -keystore \"$KEYSTORE_PATH\""
echo ""
