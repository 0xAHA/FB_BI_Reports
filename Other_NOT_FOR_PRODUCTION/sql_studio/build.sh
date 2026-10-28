#!/bin/bash
# sql_studio — build the plugin jar (Git Bash on Windows).
#
#   ./build.sh              compile + package  -> target/sql-studio.jar
#   ./build.sh --check      ... and run the page's script tests (src/test/js) with node
#   ./build.sh --install    ... and copy it into the Fishbowl plugins folder, removing
#                           any older sql-studio jar (restart the Fishbowl client)
#
# The jar name carries no version (it is in the manifest), so an upgrade replaces
# the old jar instead of leaving two copies of the plugin in plugins/.
#
# Compiles against the Fishbowl client's own jars, exactly as report_btn does. No
# JDK needed: when JAVA_HOME has no javac, the Eclipse compiler (ECJ, bundled with
# VS Code's Java extension) runs on Fishbowl's own Java 21 runtime.
#
# Environment:
#   FB_HOME   Fishbowl install folder   (default: /c/Program Files/Fishbowl)
#   JAVA_HOME a JDK 21+ with javac       (optional)
#   ECJ_JAR   an ECJ jar                  (optional)
set -euo pipefail

VERSION="0.1.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
FB_HOME="${FB_HOME:-/c/Program Files/Fishbowl}"
SRC="$HERE/src/main/java"
WEB="$HERE/src/main/web"
OUT="$HERE/target"
CLASSES="$OUT/classes"
JAR="$OUT/sql-studio.jar"

CHECK=0; INSTALL=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        --install) INSTALL=1 ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

[ -d "$FB_HOME/lib" ] || { echo "Fishbowl lib folder not found: $FB_HOME/lib (set FB_HOME)"; exit 1; }

# The page's tests first: a jar whose page is broken is worse than no jar.
if [ "$CHECK" = 1 ]; then
    for t in "$HERE"/src/test/js/*.test.js; do
        ( cd "$(dirname "$t")" && node "$(basename "$t")" ) || { echo "FAILED: $(basename "$t")"; exit 1; }
    done
fi

rm -rf "$OUT"
mkdir -p "$CLASSES/META-INF"
# Relative source paths (the repo path has spaces); compile from inside src/.
cd "$SRC"
mapfile -t SOURCES < <(/usr/bin/find com/fbi/plugins/sqlstudio -name '*.java' | sort)
# ECJ does not expand classpath wildcards: list every Fishbowl jar.
LIBCP=$(for j in "$FB_HOME"/lib/*.jar; do cygpath -w "$j"; done | paste -sd ';')

if [ -n "${JAVA_HOME:-}" ] && { [ -x "$JAVA_HOME/bin/javac" ] || [ -x "$JAVA_HOME/bin/javac.exe" ]; }; then
    echo "Compiling with javac ($JAVA_HOME)"
    "$JAVA_HOME/bin/javac" --release 21 -encoding UTF-8 -nowarn \
        -cp "$LIBCP" -d "$(cygpath -w "$CLASSES")" "${SOURCES[@]}"
else
    ECJ="${ECJ_JAR:-$(ls -1 "$HOME"/.vscode/extensions/redhat.java-*/server/plugins/org.eclipse.jdt.core.compiler.batch_*.jar 2>/dev/null | tail -1)}"
    [ -n "$ECJ" ] && [ -f "$ECJ" ] || { echo "No javac (JAVA_HOME) and no ECJ jar found (install VS Code's Java extension or set ECJ_JAR)"; exit 1; }
    echo "Compiling with ECJ on Fishbowl's Java runtime ($(basename "$ECJ"))"
    "$FB_HOME/jre/bin/java.exe" -jar "$(cygpath -w "$ECJ")" -21 -encoding UTF-8 -nowarn -proc:none \
        -cp "$LIBCP" -d "$(cygpath -w "$CLASSES")" "${SOURCES[@]}"
fi

# The page and its files, which StudioPage inlines at load.
PAGE_DIR="$CLASSES/com/fbi/plugins/sqlstudio/web"
mkdir -p "$PAGE_DIR"
cp "$WEB"/*.htm "$WEB"/*.js "$PAGE_DIR/"
[ -n "$(ls "$WEB"/*.css 2>/dev/null)" ] && cp "$WEB"/*.css "$PAGE_DIR/"

# Excel export is fb-lib's own writer (FBLib.Export), lifted out of the repo's
# scripts/fb-lib.js rather than copied, so a fix there reaches this jar at the
# next build. The block is self-contained: its few calls into FBLib.Common sit
# in try/catch, and here Common is an empty object.
FBLIB="$HERE/../../scripts/fb-lib.js"
[ -f "$FBLIB" ] || { echo "fb-lib not found: $FBLIB"; exit 1; }
{
    echo "/* FBLib.Export, lifted from scripts/fb-lib.js by build.sh. Do not edit here. */"
    echo "(function (root) {"
    echo "    'use strict';"
    echo "    const Common = {};"
    awk '/^    const Export = \(function \(\) \{$/{on=1} on{print} on&&/^    \}\)\(\);$/{exit}' "$FBLIB"
    echo "    root.FBExport = Export;"
    echo "})(this);"
} > "$PAGE_DIR/fb-export.js"
grep -q "xlsx: xlsx" "$PAGE_DIR/fb-export.js" || { echo "Could not lift FBLib.Export out of $FBLIB"; exit 1; }

printf 'Manifest-Version: 1.0\r\nImplementation-Title: sql_studio\r\nImplementation-Version: %s\r\n\r\n' "$VERSION" > "$CLASSES/META-INF/MANIFEST.MF"

# A jar is a zip; Windows' own tar (bsdtar) writes zip with forward-slash names.
( cd "$CLASSES" && /c/Windows/System32/tar.exe -a -c -f "../sql-studio.zip" META-INF com )
mv "$OUT/sql-studio.zip" "$JAR"
echo "Built $JAR ($VERSION)"

if [ "$INSTALL" = 1 ]; then
    rm -f "$FB_HOME"/plugins/sql-studio*.jar
    cp "$JAR" "$FB_HOME/plugins/"
    echo "Installed into $FB_HOME/plugins — restart the Fishbowl client"
fi
