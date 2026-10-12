#!/bin/bash
# report_btn — build the plugin jar (Git Bash on Windows).
#
#   ./build.sh            compile + package  -> target/report-btn.jar
#   ./build.sh --check    ... and run the self-check (src/test/java) on Fishbowl's Java
#   ./build.sh --install  ... and copy it into the Fishbowl plugins folder, removing
#                         any older report-btn jar (restart the Fishbowl client)
#
# The jar name carries no version (it is in the manifest), so an upgrade replaces
# the old jar instead of leaving two copies of the plugin in plugins/.
#
# Compiles against the Fishbowl client's own jars. No JDK needed: when JAVA_HOME
# has no javac, the Eclipse compiler (ECJ, bundled with VS Code's Java extension)
# runs on Fishbowl's own Java 21 runtime. Override with ECJ_JAR=/path/to/ecj.jar.
#
# Environment:
#   FB_HOME   Fishbowl install folder   (default: /c/Program Files/Fishbowl)
#   JAVA_HOME a JDK 21+ with javac       (optional)
#   ECJ_JAR   an ECJ jar                  (optional)
set -euo pipefail

VERSION="0.4.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
FB_HOME="${FB_HOME:-/c/Program Files/Fishbowl}"
SRC="$HERE/src/main/java"
OUT="$HERE/target"
CLASSES="$OUT/classes"
JAR="$OUT/report-btn.jar"

[ -d "$FB_HOME/lib" ] || { echo "Fishbowl lib folder not found: $FB_HOME/lib (set FB_HOME)"; exit 1; }

rm -rf "$OUT"
mkdir -p "$CLASSES/META-INF"
# Relative source paths (the repo path has spaces); compile from inside src/.
cd "$SRC"
SOURCES=(com/fbi/plugins/reportbtn/*.java)
# ECJ does not expand classpath wildcards: list every Fishbowl jar.
LIBCP=$(for j in "$FB_HOME"/lib/*.jar; do cygpath -w "$j"; done | paste -sd ';')

# compile <output dir> <extra classpath> <sources...>
compile() {
    local out="$1" extra="$2"
    shift 2
    if [ -n "${JAVA_HOME:-}" ] && { [ -x "$JAVA_HOME/bin/javac" ] || [ -x "$JAVA_HOME/bin/javac.exe" ]; }; then
        echo "Compiling with javac ($JAVA_HOME)"
        "$JAVA_HOME/bin/javac" --release 21 -encoding UTF-8 -nowarn \
            -cp "$extra$LIBCP" -d "$(cygpath -w "$out")" "$@"
    else
        ECJ="${ECJ_JAR:-$(ls -1 "$HOME"/.vscode/extensions/redhat.java-*/server/plugins/org.eclipse.jdt.core.compiler.batch_*.jar 2>/dev/null | tail -1)}"
        [ -n "$ECJ" ] && [ -f "$ECJ" ] || { echo "No javac (JAVA_HOME) and no ECJ jar found (install VS Code's Java extension or set ECJ_JAR)"; exit 1; }
        echo "Compiling with ECJ on Fishbowl's Java runtime ($(basename "$ECJ"))"
        "$FB_HOME/jre/bin/java.exe" -jar "$(cygpath -w "$ECJ")" -21 -encoding UTF-8 -nowarn -proc:none \
            -cp "$extra$LIBCP" -d "$(cygpath -w "$out")" "$@"
    fi
}

compile "$CLASSES" "" "${SOURCES[@]}"

printf 'Manifest-Version: 1.0\r\nImplementation-Title: report_btn\r\nImplementation-Version: %s\r\n\r\n' "$VERSION" > "$CLASSES/META-INF/MANIFEST.MF"

# A jar is a zip; Windows' own tar (bsdtar) writes zip with forward-slash names.
( cd "$CLASSES" && /c/Windows/System32/tar.exe -a -c -f "../report-btn.zip" META-INF com )
mv "$OUT/report-btn.zip" "$JAR"
echo "Built $JAR"

if [ "${1:-}" = "--check" ]; then
    TESTS="$OUT/test-classes"
    mkdir -p "$TESTS"
    cd "$HERE/src/test/java"
    compile "$TESTS" "$(cygpath -w "$CLASSES");" com/fbi/plugins/reportbtn/*.java
    "$FB_HOME/jre/bin/java.exe" -cp "$(cygpath -w "$TESTS");$(cygpath -w "$CLASSES");$LIBCP" com.fbi.plugins.reportbtn.SelfCheck
    exit $?
fi

if [ "${1:-}" = "--install" ]; then
    rm -f "$FB_HOME"/plugins/report-btn*.jar
    cp "$JAR" "$FB_HOME/plugins/"
    echo "Installed into $FB_HOME/plugins — restart the Fishbowl client"
fi
