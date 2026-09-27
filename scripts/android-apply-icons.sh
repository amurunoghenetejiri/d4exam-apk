#!/usr/bin/env bash
# Generate D4EXAM launcher icons into an existing android/ tree.
# Never exits non-zero — a missing icon should not block the APK build.
set -uo pipefail

DRAW="android/app/src/main/res/drawable"
mkdir -p "$DRAW"

ICON_SRC=""
for candidate in public/icon-512.png public/logo.png public/apple-touch-icon.png public/favicon.png; do
  if [ -f "$candidate" ]; then
    ICON_SRC="$candidate"
    break
  fi
done

if [ -z "$ICON_SRC" ]; then
  echo "WARN: no brand icon in public/; keeping Cap default"
  exit 0
fi

echo "Using icon source: $ICON_SRC"

# Prefer Python Pillow (reliable on GHA). Fall back to ImageMagick.
resize_icon() {
  local src="$1" size="$2" dest="$3" inset_pct="${4:-100}"
  python3 - "$src" "$size" "$dest" "$inset_pct" <<'PY' || return 1
import sys
from pathlib import Path
src, size_s, dest, inset_s = sys.argv[1:5]
size = int(size_s)
inset = max(1, min(100, int(inset_s)))
try:
    from PIL import Image
except ImportError:
    sys.exit(2)
img = Image.open(src).convert("RGBA")
fg = max(1, int(size * inset / 100))
img = img.resize((fg, fg), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
off = (size - fg) // 2
canvas.paste(img, (off, off), img)
Path(dest).parent.mkdir(parents=True, exist_ok=True)
canvas.save(dest, "PNG")
print("wrote", dest)
PY
}

# Ensure Pillow available
if ! python3 -c "from PIL import Image" 2>/dev/null; then
  pip3 install --user -q pillow || sudo pip3 install -q pillow || true
fi

if ! python3 -c "from PIL import Image" 2>/dev/null; then
  echo "WARN: Pillow unavailable; trying ImageMagick"
  sudo apt-get update -qq || true
  sudo apt-get install -y -qq imagemagick || true
fi

OK=0
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dens="${pair%%:*}"
  px="${pair##*:}"
  dir="android/app/src/main/res/mipmap-${dens}"
  mkdir -p "$dir"
  if resize_icon "$ICON_SRC" "$px" "$dir/ic_launcher.png" 100; then
    resize_icon "$ICON_SRC" "$px" "$dir/ic_launcher_round.png" 100 || true
    resize_icon "$ICON_SRC" "$px" "$dir/ic_launcher_foreground.png" 72 || true
    OK=1
  elif command -v convert >/dev/null 2>&1; then
    convert "$ICON_SRC" -resize "${px}x${px}" -background none -gravity center -extent "${px}x${px}" "$dir/ic_launcher.png" && OK=1 || true
    convert "$ICON_SRC" -resize "${px}x${px}" -background none -gravity center -extent "${px}x${px}" "$dir/ic_launcher_round.png" || true
    fg=$(( px * 72 / 100 ))
    convert "$ICON_SRC" -resize "${fg}x${fg}" -background none -gravity center -extent "${px}x${px}" "$dir/ic_launcher_foreground.png" || true
  else
    echo "WARN: could not write icons for $dens"
  fi
done

if [ "$OK" -eq 1 ]; then
  ANY="android/app/src/main/res/mipmap-anydpi-v26"
  mkdir -p "$ANY"
  printf '%s\n' \
    '<?xml version="1.0" encoding="utf-8"?>' \
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">' \
    '    <background android:drawable="@color/splash_background"/>' \
    '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>' \
    '</adaptive-icon>' > "$ANY/ic_launcher.xml"
  cp "$ANY/ic_launcher.xml" "$ANY/ic_launcher_round.xml"
  resize_icon "$ICON_SRC" 48 "$DRAW/ic_stat_d4exam.png" 100 || true
  echo "OK: D4EXAM launcher icons written"
  ls -la android/app/src/main/res/mipmap-xxxhdpi/ || true
else
  echo "WARN: icon generation failed; Cap default icon kept"
fi


# Native launch splash logo (navy screen + centered brand mark from first frame)
# Written AFTER drawable XML cleanup in CI so PNG is not deleted by basename loop.
for dest in \
  "android/app/src/main/res/drawable/d4exam_splash_logo.png" \
  "native-android/app/src/main/res/drawable/d4exam_splash_logo.png"; do
  mkdir -p "$(dirname "$dest")"
  if resize_icon "$ICON_SRC" 240 "$dest" 90; then
    echo "OK: splash logo -> $dest"
  elif command -v convert >/dev/null 2>&1; then
    convert "$ICON_SRC" -resize 216x216 -background none -gravity center -extent 240x240 "$dest" \
      && echo "OK: splash logo (convert) -> $dest" || true
  else
    echo "WARN: could not write $dest"
  fi
done

exit 0
