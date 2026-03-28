#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST_DIR="$ROOT_DIR/dist"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  read -r -p "Enter version (for example 1.0.0): " VERSION
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Invalid version: $VERSION"
  echo "Expected format: x.y.z"
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to read manifest.json"
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip is required to create the archive"
  exit 1
fi

MANIFEST_VERSION="$(
  cd "$ROOT_DIR"
  python3 - <<'PY'
import json
with open("manifest.json", "r", encoding="utf-8") as f:
    print(json.load(f)["version"])
PY
)"

if [[ "$MANIFEST_VERSION" != "$VERSION" ]]; then
  echo "Version mismatch:"
  echo "  manifest.json: $MANIFEST_VERSION"
  echo "  requested:     $VERSION"
  echo "Update manifest.json first, then run the packager again."
  exit 1
fi

PACKAGE_NAME="devtrace-v$VERSION"
PACKAGE_DIR="$DIST_DIR/$PACKAGE_NAME"
ZIP_PATH="$DIST_DIR/$PACKAGE_NAME.zip"

FILES=(
  manifest.json
  background.js
  popup.html
  popup.js
  popup-utils.js
  popup-services.js
  help.html
  help.js
  icon16.png
  icon48.png
  icon128.png
  default_icon16.png
  default_icon48.png
  default_icon128.png
)

mkdir -p "$DIST_DIR"
rm -rf "$PACKAGE_DIR"
rm -f "$ZIP_PATH"
mkdir -p "$PACKAGE_DIR"

for file in "${FILES[@]}"; do
  if [[ ! -f "$ROOT_DIR/$file" ]]; then
    echo "Missing required file: $file"
    exit 1
  fi
  cp "$ROOT_DIR/$file" "$PACKAGE_DIR/"
done

(
  cd "$PACKAGE_DIR"
  zip -rq "$ZIP_PATH" .
)

echo "Package created:"
echo "  $ZIP_PATH"
