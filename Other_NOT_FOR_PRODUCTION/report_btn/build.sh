#!/bin/bash
# report_btn — build the plugin jar (Git Bash on Windows).
#
#   ./build.sh              compile + package  -> target/report-btn.jar
#   ./build.sh --check      ... and run the self-checks (src/test/java) on Fishbowl's Java
#   ./build.sh --install    ... and copy it into the Fishbowl plugins folder, removing
#                           any older report-btn jar (restart the Fishbowl client)
#   ./build.sh --no-editor  leave the page editor (the editor/ packages) out, which is
#                           what deleting those folders does; combines with the others
#   ./build.sh --no-docs    leave the documents and email PoC (the docs/ packages) out
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

VERSION="0.7.9"
HERE="$(cd "$(dirname "$0")" && pwd)"
FB_HOME="${FB_HOME:-/c/Program Files/Fishbowl}"
SRC="$HERE/src/main/java"
OUT="$HERE/target"
CLASSES="$OUT/classes"
JAR="$OUT/report-btn.jar"
REPO_SCRIPTS="$(cd "$HERE/../../scripts" 2>/dev/null && pwd || true)"

CHECK=0; INSTALL=0; NO_EDITOR=0; NO_DOCS=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        --install) INSTALL=1 ;;
        --no-editor) NO_EDITOR=1 ;;
        --no-docs) NO_DOCS=1 ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

[ -d "$FB_HOME/lib" ] || { echo "Fishbowl lib folder not found: $FB_HOME/lib (set FB_HOME)"; exit 1; }

# Every file named like $1 under the package, sub-packages included; --no-editor
# skips editor/ and --no-docs skips docs/.
files() {
    local skip=()
    [ "$NO_EDITOR" = 1 ] && skip+=(-not -path '*/editor/*')
    [ "$NO_DOCS" = 1 ] && skip+=(-not -path '*/docs/*')
    /usr/bin/find com/fbi/plugins/reportbtn -name "$1" ${skip[@]+"${skip[@]}"} | sort
}
sources() {
    files '*.java'
}

rm -rf "$OUT"
mkdir -p "$CLASSES/META-INF"
# Relative source paths (the repo path has spaces); compile from inside src/.
cd "$SRC"
mapfile -t SOURCES < <(sources)
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

# Pages kept beside their classes (e.g. the email composer's editor page).
while IFS= read -r res; do
    mkdir -p "$CLASSES/$(dirname "$res")"
    cp "$res" "$CLASSES/$res"
done < <(files '*.htm')

# The App Library (Home) is built in: only its page goes into the jar. Its includes
# (fb-lib, fb-styles) stay the scripts saved in Fishbowl; the server expands them.
LIBRARY="$CLASSES/com/fbi/plugins/reportbtn/library"
PAGE="$HERE/../Report_Launcher/Report_Launcher.htm"
[ -f "$PAGE" ] || { echo "App Library page missing: $PAGE"; exit 1; }
mkdir -p "$LIBRARY"
cp "$PAGE" "$LIBRARY/App_Library.htm"

printf 'Manifest-Version: 1.0\r\nImplementation-Title: report_btn\r\nImplementation-Version: %s\r\n\r\n' "$VERSION" > "$CLASSES/META-INF/MANIFEST.MF"

# A jar is a zip; Windows' own tar (bsdtar) writes zip with forward-slash names.
( cd "$CLASSES" && /c/Windows/System32/tar.exe -a -c -f "../report-btn.zip" META-INF com )
mv "$OUT/report-btn.zip" "$JAR"
echo "Built $JAR$([ "$NO_EDITOR" = 1 ] && echo ' (without the page editor)')$([ "$NO_DOCS" = 1 ] && echo ' (without the documents PoC)')"

if [ "$CHECK" = 1 ]; then
    TESTS="$OUT/test-classes"
    mkdir -p "$TESTS"
    cd "$HERE/src/test/java"
    mapfile -t TEST_SOURCES < <(sources)
    compile "$TESTS" "$(cygpath -w "$CLASSES");" "${TEST_SOURCES[@]}"
    "$FB_HOME/jre/bin/java.exe" -Djava.awt.headless=true \
        ${REPO_SCRIPTS:+-Dreportbtn.scripts="$(cygpath -w "$REPO_SCRIPTS")"} \
        -Dreportbtn.repo="$(cygpath -w "$HERE/../..")" \
        -Dreportbtn.fbhome="$(cygpath -w "$FB_HOME")" \
        -cp "$(cygpath -w "$TESTS");$(cygpath -w "$CLASSES");$LIBCP" com.fbi.plugins.reportbtn.SelfCheck
fi

if [ "$INSTALL" = 1 ]; then
    rm -f "$FB_HOME"/plugins/report-btn*.jar
    cp "$JAR" "$FB_HOME/plugins/"
    echo "Installed into $FB_HOME/plugins — restart the Fishbowl client"
fi
