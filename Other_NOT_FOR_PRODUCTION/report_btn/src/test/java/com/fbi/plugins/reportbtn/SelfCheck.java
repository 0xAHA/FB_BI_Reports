package com.fbi.plugins.reportbtn;

import java.util.Set;

/**
 * Checks the plugin's pure helpers without a running client:
 *   ./build.sh --check
 * Exits non-zero on the first failure.
 */
public final class SelfCheck {

    private static int passed;

    public static void main(String[] args) {
        // WorkspaceLink: the openModule('Apps (beta)', item) grammar.
        link("123", "OPEN #123");
        link("  42 ", "OPEN #42");
        link("tab:123", "OPEN tab #123");
        link("TAB: 7", "OPEN tab #7");
        link("- Sales - Sales Order Summary", "OPEN \"- Sales - Sales Order Summary\"");
        link("tab:- Sales - X", "OPEN tab \"- Sales - X\"");
        link("home", "HOME");
        link("Home", "HOME");
        link("tab:home", "HOME tab");
        link("back", "BACK");
        link("FORWARD", "FORWARD");
        link("tab:back", null);
        link("", null);
        link("   ", null);
        link("tab:", null);
        link(null, null);
        link("0", null);
        link("9999999999", "OPEN \"9999999999\"");   // too long for an id: treated as a name
        link("12abc", "OPEN \"12abc\"");
        link("edit:123", "EDIT #123");
        link("EDIT: 7", "EDIT #7");
        link("edit:Sales Order Summary", "EDIT \"Sales Order Summary\"");
        link("tab:edit:5", "EDIT #5");
        link("edit:", null);
        link("edit:0", null);
        link("editor report", "OPEN \"editor report\"");
        link("build:publish:3f9a2c1d", "BUILD publish 3f9a2c1d");
        link("BUILD: publish:ab_c-1", "BUILD publish ab_c-1");
        link("build:publish", "BUILD publish");
        link("build:publish:a b", null);
        link("build:publish:a'b", null);
        link("build:", null);
        link("tab:build:publish:x", "BUILD publish x");

        // insertScript: after the first real head tag, never inside a comment.
        eq(AppLauncher.insertScript("<html><head><title>x</title></head></html>", "FB_WORKSPACE", "{}"),
            "<html><head><script>window.FB_WORKSPACE={};</script><title>x</title></head></html>", "insertScript head");
        eq(AppLauncher.insertScript("<!-- <head> --><head lang=\"en\">", "A", "1"),
            "<!-- <head> --><head lang=\"en\"><script>window.A=1;</script>", "insertScript skips a commented head");
        eq(AppLauncher.insertScript("<body>x</body>", "A", "1"),
            "<script>window.A=1;</script><body>x</body>", "insertScript without head");

        // jsonString: safe inside a script tag and against setting-token substitution.
        eq(AppLauncher.jsonString("a\"b\\c</script>$SO{x}"), "\"a\\\"b\\\\c\\u003c/script>\\u0024SO{x}\"", "jsonString escapes");

        // fb-launch tag parsing (Apps menu).
        Set<String> keys = AppCatalog.launchModules("<meta content=\"so, purchasing\" name=\"fb-launch\">");
        eq(String.join(",", keys), "SO,PURCHASING", "launchModules");

        // The built-in App Library: only its page is in the jar; the server expands its includes.
        String library = AppLibrary.page();
        eq(String.valueOf(library != null), "true", "App Library page in the build");
        if (library != null) {
            eq(count(library, "{% Script fb-lib %}") + "/" + count(library, "{% Style fb-styles %}"), "1/1",
                "App Library: each include written once");
            eq(String.valueOf(library.contains("name:  '" + ReportWorkspacePlugin.HOME_REPORT + "'")), "true",
                "App Library: the page's own name matches Home");
        }
        eq(String.valueOf(AppLibrary.class.getResource("/com/fbi/plugins/reportbtn/library/fb-lib.js") == null), "true",
            "fb-lib is not built in (Fishbowl's saved copy is used)");

        System.out.println("SelfCheck: " + passed + " checks passed");

        // The page editor's own checks, when it is part of the build (--no-editor leaves it out).
        try {
            Class.forName("com.fbi.plugins.reportbtn.editor.EditorSelfCheck").getMethod("run").invoke(null);
        } catch (ClassNotFoundException e) {
            System.out.println("EditorSelfCheck: editor not built; skipped");
        } catch (java.lang.reflect.InvocationTargetException e) {
            Throwable cause = e.getCause();
            System.out.println("FAIL EditorSelfCheck: " + cause);
            if (cause != null) {
                cause.printStackTrace(System.out);
            }
            System.exit(1);
        } catch (ReflectiveOperationException e) {
            System.out.println("FAIL EditorSelfCheck could not run: " + e);
            System.exit(1);
        }
    }

    private static void link(String item, String expected) {
        WorkspaceLink l = WorkspaceLink.parse(item);
        eq(l == null ? null : l.toString(), expected, "WorkspaceLink.parse(" + (item == null ? "null" : "\"" + item + "\"") + ")");
    }

    private static int count(String text, String part) {
        int n = 0;
        for (int i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + part.length())) {
            n++;
        }
        return n;
    }

    private static void eq(String actual, String expected, String what) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            System.out.println("FAIL " + what + "\n  expected: " + expected + "\n  actual:   " + actual);
            System.exit(1);
        }
        passed++;
    }
}
