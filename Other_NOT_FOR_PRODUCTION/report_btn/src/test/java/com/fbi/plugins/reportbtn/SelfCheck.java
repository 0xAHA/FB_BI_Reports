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
        // WorkspaceLink: the openModule('Report Workspace', item) grammar.
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

        System.out.println("SelfCheck: " + passed + " checks passed");
    }

    private static void link(String item, String expected) {
        WorkspaceLink l = WorkspaceLink.parse(item);
        eq(l == null ? null : l.toString(), expected, "WorkspaceLink.parse(" + (item == null ? "null" : "\"" + item + "\"") + ")");
    }

    private static void eq(String actual, String expected, String what) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            System.out.println("FAIL " + what + "\n  expected: " + expected + "\n  actual:   " + actual);
            System.exit(1);
        }
        passed++;
    }
}
