package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.AccessLevelConst;
import com.fbi.sdk.constants.bi.QueryParamTypeConst;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The page editor's pure parts, checked without a client (run by SelfCheck):
 * the JS lexer and module index over the repo's real scripts/*.js
 * (-Dreportbtn.scripts), include parsing, insert text, the access policy and
 * the template rewrite (-Dreportbtn.repo).
 */
public final class EditorSelfCheck {

    private static int passed;

    private EditorSelfCheck() {
    }

    public static void run() throws Exception {
        lexer();
        jsdoc();
        explorer();
        modules();
        includes();
        inserts();
        policy();
        importDiff();
        layout();
        dropped();
        template();
        builderPage();
        System.out.println("EditorSelfCheck: " + passed + " checks passed");
    }

    // ------------------------------------------------------------------ lexer
    private static void lexer() {
        String src = String.join("\n",
            "(function (global) {",
            "  var sql = `SELECT { } FROM x WHERE a = ${ {a: 1}.a } AND b = ${ `in ${'}'} ner` }`;",
            "  var re = /[{}]/g, re2 = (/}/), half = a / b / c;",
            "  function f() { return /\\{[^}]*\\}/.test(x); }",
            "  var s = '{ not a brace }' + \"}\"; // { comment brace",
            "  /* { block brace */",
            "  global.FBTest = { f, g: function (x, y = 2) {}, h: () => 1, get v() { return 1; }, 'q': f };",
            "})(window);");
        JsIndex.Module m = JsIndex.index("test", src);
        JsIndex.Symbol root = m.find("FBTest");
        check(root != null, "lexer: the module root survives braces in templates, regexes, strings and comments");
        check(root != null && root.children.size() == 5, "lexer: all five members found (" + (root == null ? 0 : root.children.size()) + ")");
        eq(kind(m, "FBTest.f"), "FUNCTION", "shorthand resolves to the function");
        eq(params(m, "FBTest.g"), "x, y", "defaults are dropped from params");
        eq(kind(m, "FBTest.h"), "FUNCTION", "arrow function");
        eq(kind(m, "FBTest.v"), "GETTER", "getter");
        eq(kind(m, "FBTest.q"), "FUNCTION", "quoted key");
        eq(JsIndex.cleanParams(" a, { x, y } = {}, [p, q], cb = () => {} "), "a, {x, y}, [p, q], cb", "cleanParams");
    }

    // ------------------------------------------------------------------ modules
    // ------------------------------------------------------------------ explorer
    private static void explorer() {
        eq(AppGroups.launchContent("<head>\n<meta name=\"fb-launch\" content=\"SO, PICK\">\n"), "SO, PICK", "launch tag content");
        eq(AppGroups.launchContent("<meta content='MATERIALS' name='fb-launch'>"), "MATERIALS", "either attribute order and quote");
        eq(AppGroups.launchContent("<meta name=\"description\" content=\"x\">"), "", "no launch tag");
        eq(String.valueOf(AppGroups.places("SO, PICK, SALES")), "[sales/SO, sales/PICK, sales]", "modules under their group, group keys direct");
        eq(String.valueOf(AppGroups.places("WO MATERIALS")), "[materials, manufacturing/WO]", "groups in menu order");
        eq(String.valueOf(AppGroups.places("")), "[none]", "untagged: Not assigned");
        eq(String.valueOf(AppGroups.places("NONE")), "[none]", "NONE: Not assigned");
        eq(AppGroups.moduleLabel("RECEIPT"), "Receiving", "module label");
        eq(AppGroups.retag("SO, PICK", "SO", "PO"), "PICK, PO", "move: replace the source key");
        eq(AppGroups.retag("so,PICK", null, "SO"), "so, PICK", "copy: an existing key (any case) isn't added twice");
        eq(AppGroups.retag("SO X1", "SO", null), "X1", "to Not assigned: unknown keys stay");
        eq(AppGroups.retag("", null, "SALES"), "SALES", "from Not assigned");
        String page = "<!DOCTYPE html>\n<html>\n<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"fb-launch\" content=\"SO\">\n</head>";
        eq(AppGroups.rewrite(page, "PO, PICK"), page.replace("content=\"SO\"", "content=\"PO, PICK\""), "rewrite the first tag");
        eq(AppGroups.rewrite("<meta content='SO' name='fb-launch'/>", "PO"), "<meta content='PO' name='fb-launch'/>", "rewrite keeps quotes");
        String bare = "<html>\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <title>x</title>";
        eq(AppGroups.rewrite(bare, "MO"), "<html>\r\n<head>\r\n  <meta charset=\"UTF-8\">\r\n  <meta name=\"fb-launch\" content=\"MO\">\r\n  <title>x</title>",
            "a page without the tag gets one after its charset meta");
        eq(AppGroups.rewrite("<p>no head</p>", "MO"), "<meta name=\"fb-launch\" content=\"MO\">\n<p>no head</p>",
            "a bare fragment gets the tag on its first line");
        eq(AppGroups.rewrite("<html>\n<body>x</body>", "MO"), "<html>\n    <meta name=\"fb-launch\" content=\"MO\">\n<body>x</body>",
            "no head: after <html>");
        String tagged = "<head>\n    <meta charset=\"UTF-8\">\n    <meta name=\"fb-launch\" content=\"SO\">\n</head>";
        eq(AppGroups.setFolder(tagged, "Customer"), tagged.replace("content=\"SO\">", "content=\"SO\">\n    <meta name=\"fb-folder\" content=\"Customer\">"),
            "the folder tag goes after the module tag");
        eq(AppGroups.folderContent(AppGroups.setFolder(tagged, "Customer")), "Customer", "folder reads back");
        eq(AppGroups.setFolder(AppGroups.setFolder(tagged, "Customer"), "Inventory"), AppGroups.setFolder(tagged, "Inventory"), "refile rewrites in place");
        eq(AppGroups.setFolder(AppGroups.setFolder(tagged, "Customer"), null), tagged, "Unfiled removes the tag and its line");
        eq(AppGroups.setFolder("<html><head><title>t</title>", "Other"), "<html><head>\n    <meta name=\"fb-folder\" content=\"Other\"><title>t</title>",
            "no charset meta: after head");
        // fb-origin: after the folder tag, else after the module tag; system only when it says so.
        String filed = AppGroups.setFolder(tagged, "Customer");
        eq(AppGroups.setOrigin(filed, AppGroups.SYSTEM), filed.replace("content=\"Customer\">",
            "content=\"Customer\">\n    <meta name=\"fb-origin\" content=\"system\">"), "the origin tag goes after the folder tag");
        eq(AppGroups.setOrigin(tagged, AppGroups.SYSTEM), tagged.replace("content=\"SO\">",
            "content=\"SO\">\n    <meta name=\"fb-origin\" content=\"system\">"), "no folder tag: after the module tag");
        check(AppGroups.isSystem(AppGroups.setOrigin(filed, AppGroups.SYSTEM)), "system reads back");
        check(!AppGroups.isSystem(AppGroups.setOrigin(AppGroups.setOrigin(filed, AppGroups.SYSTEM), AppGroups.CUSTOM)),
            "custom rewrites it in place");
        check(!AppGroups.isSystem(filed) && !AppGroups.isSystem(null), "no tag: custom");
        check(AppGroups.folderProblem("Unfiled").length() > 0 && AppGroups.folderProblem("Sales Order").isEmpty(), "folder names");
        check(AppGroups.compareFolders("_Babor", "Accounting") < 0 && AppGroups.compareFolders("Customer", "accounting") > 0, "folder order");
        eq(AppGroups.describe("SO, SALES, XYZ"), "Sales Order, all Sales modules, XYZ (not recognised)", "describe the association");
        eq(AppGroups.keyLabel("SALES") + "|" + AppGroups.keyLabel("so"), "All Sales modules|Sales Order", "key labels");
        eq(AppGroups.launchContent(AppGroups.rewrite(bare, "SALES, SO")), "SALES, SO", "rewrite reads back");

        eq(String.valueOf(FindBar.matches("Foo foo food", "foo", false, false, false).size()), "3", "find: case-insensitive");
        eq(String.valueOf(FindBar.matches("Foo foo food", "foo", true, true, false).size()), "1", "find: match case + whole word");
        eq(String.valueOf(FindBar.matches("a.b a+b", "a.b", false, false, false).size()), "1", "find: literal dots");
        eq(String.valueOf(FindBar.matches("a1 a22 b3", "a\\d+", false, false, true).size()), "2", "find: regex");
        eq(String.valueOf(FindBar.matches("$x x", "x", false, true, false).size()), "1", "find: $ is part of a word");

        com.fbi.fbdata.bi.BiReportAccessFpo own = new com.fbi.fbdata.bi.BiReportAccessFpo();
        own.setLongId(77);
        own.setUserGroupId(1);
        own.setAccessLevel(AccessLevelConst.VIEW);
        com.fbi.fbdata.bi.BiReportAccessFpo gone = new com.fbi.fbdata.bi.BiReportAccessFpo();
        gone.setLongId(78);
        gone.setUserGroupId(2);
        gone.setAccessLevel(AccessLevelConst.VIEW);
        com.fbi.fbdata.bi.BiReportAccessFpo want1 = new com.fbi.fbdata.bi.BiReportAccessFpo();
        want1.setLongId(500);   // another report's row: must not be reused
        want1.setUserGroupId(1);
        want1.setAccessLevel(AccessPolicy.EDIT_LEVEL);
        com.fbi.fbdata.bi.BiReportAccessFpo want3 = new com.fbi.fbdata.bi.BiReportAccessFpo();
        want3.setLongId(501);
        want3.setUserGroupId(3);
        want3.setAccessLevel(AccessLevelConst.VIEW);
        List<com.fbi.fbdata.bi.BiReportAccessFpo> m = AppActions.merged(Arrays.asList(own, gone), Arrays.asList(want1, want3), 9);
        check(m.size() == 3, "access merge: 3 rows (" + m.size() + ")");
        check(m.get(0).getLongId() == 77 && m.get(0).getAccessLevel() == AccessPolicy.EDIT_LEVEL, "merge keeps the report's own row, new level");
        check(m.get(1).getLongId() == 78 && m.get(1).getAccessLevel() == AccessLevelConst.NONE, "a group not chosen is set to None");
        check(m.get(2).getUserGroupId() == 3 && m.get(2).getLongId() != 501 && m.get(2).getBiReportId() == 9, "a new group gets a new row on this report");
    }

    // ------------------------------------------------------------------ jsdoc
    private static void jsdoc() {
        String src = "// ---- Section banner: not the doc ----\n"
            + "/**\n"
            + " * Adds two numbers.\n"
            + " * Second sentence.\n"
            + " * @param {number} a - The first.\n"
            + " * @param {object} [opts] - Options.\n"
            + " * @param {number} [opts.places=2] - Decimal places.\n"
            + " * @returns {number} The sum.\n"
            + " * @example\n"
            + " *   add(1, {places: 0})\n"
            + " */\n"
            + "function add(a, opts) { return a; }\n"
            + "window.X = { add };\n";
        JsIndex.Module m = JsIndex.index("jsdoc", src);
        String d = doc(m, "X.add");
        check(!d.contains("Section banner"), "a JSDoc block stops the doc (" + d.split("\n")[0] + ")");
        check(JsDoc.tagged(d), "JSDoc tags are kept");
        JsDoc j = JsDoc.parse(d);
        eq(j.summary, "Adds two numbers.\nSecond sentence.", "JSDoc summary");
        eq(j.firstSentence(), "Adds two numbers.", "JSDoc first sentence");
        check(j.params.size() == 3, "three @params (" + j.params.size() + ")");
        JsDoc.Param places = j.params.size() == 3 ? j.params.get(2) : null;
        check(places != null && places.optional && "opts.places".equals(places.name) && "2".equals(places.defaultValue)
            && "number".equals(places.type), "optional nested param with default");
        check(j.paramNamed("a") != null && "The first.".equals(j.paramNamed("a").description), "param description");
        check(j.hasReturns && "number".equals(j.returnsType) && "The sum.".equals(j.returns), "@returns");
        check(j.examples.size() == 1 && j.examples.get(0).equals("add(1, {places: 0})"), "@example dedented (" + j.examples + ")");
        String html = Completions.html("X.add(a, opts)", d, "jsdoc");
        check(html.contains("<b>Parameters</b>") && html.contains("<b>Returns</b>") && !html.contains("@param"), "JSDoc renders as sections");
        check(Completions.html("f()", "Plain text\nsecond line", "s").contains("Plain text<br>second line"), "untagged docs render as before");
    }

    private static void modules() throws Exception {
        String dir = System.getProperty("reportbtn.scripts");
        if (dir == null || !Files.isDirectory(Paths.get(dir))) {
            System.out.println("EditorSelfCheck: no -Dreportbtn.scripts; module index checks skipped");
            return;
        }
        long t0 = System.nanoTime();
        JsIndex.Module lib = JsIndex.index("fb-lib", read(dir, "fb-lib.js"));
        long ms = (System.nanoTime() - t0) / 1_000_000;
        check(ms < 3000, "fb-lib indexes in under 3 s (" + ms + " ms)");
        JsIndex.Symbol fbl = lib.find("FBLib");
        check(fbl != null, "FBLib found (" + lib.note + ")");
        long namespaces = fbl == null ? 0 : fbl.children.values().stream().filter(s -> s.kind == JsIndex.Kind.NAMESPACE).count();
        check(namespaces >= 13, "FBLib has 13+ namespaces (" + namespaces + ")");
        eq(kind(lib, "FBLib.Common.formatMoney"), "FUNCTION", "FBLib.Common.formatMoney");
        check(params(lib, "FBLib.Common.formatMoney").startsWith("value"), "formatMoney(value…) (" + params(lib, "FBLib.Common.formatMoney") + ")");
        check(!doc(lib, "FBLib.Common.formatMoney").isEmpty(), "formatMoney has its comment as doc");
        eq(kind(lib, "FBLib.BUILD"), "VALUE", "FBLib.BUILD is a value");
        check(between(lib, "FBLib.Settings.init", "FBLib.Settings", "FBLib.CfCatalog"), "Settings.init resolves inside the Settings module");
        check(between(lib, "FBLib.Table.init", "FBLib.Table", "FBLib.Export"), "Table.init resolves inside the Table module");
        JsIndex.Symbol fva = lib.find("FBLib.FilterViews.attach"), rca = lib.find("FBLib.RptCols.attach");
        check(fva != null && rca != null && fva.line != rca.line, "FilterViews.attach and RptCols.attach are different functions");
        check(!params(lib, "FBLib.Pivot.mount").isEmpty(), "Pivot.mount has params (" + params(lib, "FBLib.Pivot.mount") + ")");
        boolean getter = lib.all().stream().anyMatch(s -> s.kind == JsIndex.Kind.GETTER);
        check(getter, "fb-lib getters are found");
        System.out.println("  fb-lib: " + (fbl == null ? 0 : fbl.count()) + " symbols, " + ms + " ms");

        JsIndex.Module mfg = JsIndex.index("fb-mfg", read(dir, "fb-mfg.js"));
        eq(kind(mfg, "FBMfg.Finisher.prepareFinish"), "FUNCTION", "FBMfg.Finisher.prepareFinish");
        check(params(mfg, "FBMfg.Finisher.prepareFinish").startsWith("woRow"), "prepareFinish(woRow, opts) (" + params(mfg, "FBMfg.Finisher.prepareFinish") + ")");
        check(mfg.find("FBMfg.Finisher.prepareFinish") != null && mfg.find("FBMfg.Finisher.prepareFinish").async, "prepareFinish is async");
        eq(kind(mfg, "FBMfg.Finisher.previewFinish"), "FUNCTION", "inline previewFinish");
        eq(kind(mfg, "FBMfg.Staging.orderRowsByChain"), "FUNCTION", "orderRowsByChain resolves through its alias");

        JsIndex.Module doc = JsIndex.index("fb-doc", read(dir, "fb-doc.js"));
        check(doc.find("FBDoc") != null, "FBDoc found (" + doc.note + ")");
        check(doc.find("FBDoc.code128") != null, "FBDoc.code128 (an identifier with digits)");
        check(doc.find("FBDoc.param") != null && doc.find("FBDoc.param.fromEl") != null,
            "FBDoc.param and its function-valued property fromEl");
        check(params(doc, "FBDoc.param.fromEl").startsWith("id"), "param.fromEl(id, fallback) (" + params(doc, "FBDoc.param.fromEl") + ")");
        check(doc.find("FBDoc.page") != null, "FBDoc.page");
        System.out.println("  fb-doc: " + (doc.find("FBDoc") == null ? 0 : doc.find("FBDoc").count()) + " symbols");

        JsIndex.Module pricing = JsIndex.index("fb-pricing", read(dir, "fb-pricing.js"));
        eq(kind(pricing, "FBPricing.loadBook"), "FUNCTION", "FBPricing.loadBook");
        check(!doc(pricing, "FBPricing.loadBook").isEmpty(), "loadBook has a doc (comment or SURFACE line)");
        check(pricing.find("FBPricing.clearCache") != null && pricing.find("FBPricing.today") != null, "clearCache, today");
    }

    // ------------------------------------------------------------------ includes
    private static void includes() {
        String page = String.join("\n",
            "<head><script>{% Script fb-lib %}</script>",
            "<script type=\"text/plain\" id=\"xlsxHolder\">{% Script xlsx %}</script>",
            "<style>{% Style fb-styles %}</style>",
            "<!-- {% Script fb-lib %} -->");
        List<PageIncludes.Include> inc = PageIncludes.find(page);
        eq(String.valueOf(inc.size()), "4", "four directives");
        check(!inc.get(0).holder && inc.get(1).holder, "the text/plain holder is recognised");
        check(inc.get(0).duplicate && inc.get(3).duplicate && !inc.get(2).duplicate, "the repeated directive is flagged");
        eq(PageIncludes.includeName("Part QR Code Label"), "Part_QR_Code_Label", "include names use _ for spaces");
        check(PageIncludes.contains(page, "style", "FB-STYLES"), "contains() ignores case");
    }

    // ------------------------------------------------------------------ inserts
    private static void inserts() {
        eq(Inserts.directive("Script", "fb lib"), "{% Script fb_lib %}", "directive");
        eq(Inserts.include("Script", "fb-mfg", "<head>\n", "\n"), "<script>\n{% Script fb-mfg %}\n</script>", "wrapped outside a script");
        eq(Inserts.include("Script", "fb-mfg", "<script>\n// here ", "\n"), "{% Script fb-mfg %}", "bare inside a script");
        eq(Inserts.include("Style", "fb-styles", "<style>a{}</style>\n", "\n"), "<style>\n{% Style fb-styles %}\n</style>", "wrapped after a closed style");
        // The token format Fishbowl's own dialog writes (seen in demodb pages).
        eq(Inserts.setting(QueryParamTypeConst.CHECK_BOX, "Show Barcode", "1", "General", false), "$CHECK{Show_Barcode|1|General}", "CHECK token");
        eq(Inserts.setting(QueryParamTypeConst.PART, "Part", "", "General", false), "$PART{Part|%|General}", "optional PART token");
        check(!Inserts.canBeRequired(QueryParamTypeConst.CHECK_BOX) && Inserts.canBeRequired(QueryParamTypeConst.SALES_ORDER), "required rules");
        eq(Inserts.settingHolder("$SO{Sales Order}", "Sales Order", "\n"), "<script type=\"text/plain\" id=\"set-sales-order\">$SO{Sales Order}</script>", "holder");
    }

    // ------------------------------------------------------------------ policy
    // ------------------------------------------------------------------ import
    private static void importDiff() {
        java.util.Map<Integer, String> before = new java.util.HashMap<>();
        before.put(1, "2026-10-01 09:00:00");
        before.put(2, "2026-10-01 09:00:00");
        java.util.Map<Integer, String> after = new java.util.HashMap<>(before);
        after.put(2, "2026-10-21 10:00:05");   // re-imported
        after.put(9, "2026-10-21 10:00:04");   // new, imported first
        eq(String.valueOf(ScriptService.changed(before, after)), "[9, 2]", "import: new and changed, last imported last");
        check(ScriptService.changed(before, before).isEmpty(), "import: a cancelled import opens nothing");
        check(ScriptService.changed(new java.util.HashMap<>(), after).isEmpty(), "import: a failed first read opens nothing");
    }

    // ------------------------------------------------------------------ layout
    private static void layout() {
        EditorLayout d = EditorLayout.of(null);
        eq(d.format(), "apps=270;insert=340;code=0.5;preview=below;showApps=1;showInsert=1;wrap=1", "layout: the defaults");
        check(d.wrap && EditorLayout.of("apps=300").wrap, "layout: long lines wrap unless turned off");
        check(!EditorLayout.of("wrap=0").wrap && EditorLayout.of("wrap=x").wrap, "layout: wrap=0 turns wrap off");
        EditorLayout l = EditorLayout.of("apps=300;insert=420;code=0.65;preview=right;showApps=0;showInsert=1;wrap=0");
        eq(EditorLayout.of(l.format()).format(), l.format(), "layout: format and parse round-trip");
        check(l.appsWidth == 300 && l.insertWidth == 420 && l.previewRight && !l.showApps && !l.wrap, "layout: parsed");
        EditorLayout bad = EditorLayout.of("apps=x;insert=5;code=3;junk");
        check(bad.appsWidth == 270 && bad.insertWidth == 160 && bad.codeRatio == 0.9, "layout: bad values fall back or clamp");
    }

    // ------------------------------------------------------------------ dropped files
    private static void dropped() {
        DroppedFile page = DroppedFile.parse("Open Orders.htm", "\uFEFF<html></html>", 10);
        check(page.error == null && page.confirm == null && "<html></html>".equals(page.text) && page.name == null,
            "drop: an .htm on an app loads its text, BOM dropped");
        check(DroppedFile.parse("x.css", "a{}", 20).confirm != null, "drop: a .css on a script asks first");
        check(DroppedFile.parse("x.htm", "<p>", 40).confirm == null, "drop: HTML on a template is fine");
        check(DroppedFile.parse("notes.txt", "hi", 30).confirm == null, "drop: any other text loads");
        check(DroppedFile.parse("logo.png", "x", 10).error != null, "drop: an image is refused");
        String json = "[ {\r\n  \"name\" : \"fb-styles\",\r\n  \"description\" : \"Shared CSS\",\r\n"
            + "  \"data\" : \"a{}\\r\\nb{}\",\r\n  \"active\" : true,\r\n  \"note\" : \"\",\r\n  \"type\" : \"Style\"\r\n} ]";
        DroppedFile ex = DroppedFile.parse("fb-styles-Style.json", json, 30);
        check(ex.error == null && "fb-styles".equals(ex.name) && "Shared CSS".equals(ex.description) && "a{}\r\nb{}".equals(ex.text),
            "drop: an export fills the code, name and description (" + ex.error + ")");
        check(DroppedFile.parse("fb-styles-Style.json", json, 20).error != null, "drop: a Style export on a Script tab is refused");
        check(DroppedFile.parse("bad.json", "{ nope", 10).error != null, "drop: broken JSON is refused");
        check(DroppedFile.parse("two.json", "[{\"data\":\"a\"},{\"data\":\"b\"}]", 10).error != null, "drop: a two-record file is left to Import");
        // Files dropped on the App Library.
        List<DroppedFile.Named> got = DroppedFile.payload(
            "[{\"name\":\"Open Orders.htm\",\"text\":\"<p>\"},{\"name\":\"x.png\",\"text\":\"b\"},{\"name\":\"fb-lib-Script.json\",\"text\":\"[]\"}]");
        check(got.size() == 2 && !got.get(0).isExport() && got.get(1).isExport(), "app library drop: pages and exports kept, others dropped");
        check(DroppedFile.payload("not json").isEmpty(), "app library drop: a bad payload is nothing");
        eq(DroppedFile.recordName("Open_Orders.htm", "<script>window.FB_REPORT = {\n key: 'k',\n name:  'Open Orders',\n build: 'x'\n};</script>", 10),
            "Open Orders", "app library drop: a page is named by its FB_REPORT.name");
        eq(DroppedFile.recordName("fb-lib.js", "x", 20), "fb-lib", "app library drop: a script is named after its file");
        eq(DroppedFile.metaDescription("<meta name=\"description\" content=\"Open &amp; issued orders.\">"), "Open & issued orders.",
            "app library drop: the description meta");
        eq(new DroppedFile.Named("C:\\x\\a:b.json", "").safeName(), "a_b.json", "app library drop: a safe temp file name");
        // Dropped exports pre-fill the native Import dialog through these private fields.
        try {
            Class<?> dlg = Class.forName("com.evnt.client.modules.biscripteditor.dialog.UploadScriptDialog");
            check(dlg.getDeclaredField("importFileChooser").getType() == javax.swing.JFileChooser.class
                && dlg.getDeclaredField("chkPublish").getType() == javax.swing.JCheckBox.class,
                "import dialog: its file chooser and Publish box are where the drop expects them");
        } catch (ReflectiveOperationException e) {
            check(false, "import dialog: " + e);
        }
    }

    private static void policy() {
        List<AccessPolicy.Report> one = Collections.singletonList(new AccessPolicy.Report(5, "Open Orders"));
        AccessPolicy.Rights editor = new AccessPolicy.Rights(false, true, true, false, id -> AccessPolicy.EDIT_LEVEL);
        AccessPolicy.Rights viewer = new AccessPolicy.Rights(false, true, true, true, id -> AccessLevelConst.VIEW);
        AccessPolicy.Rights noRight = new AccessPolicy.Rights(false, false, false, false, id -> AccessPolicy.EDIT_LEVEL);
        AccessPolicy.Rights admin = new AccessPolicy.Rights(true, false, false, false, id -> AccessLevelConst.NONE);
        // Edit Settings while Fishbowl has it (26.9), else View (after ADV-6032 removes it).
        check(AccessPolicy.EDIT_LEVEL.getName().equals("Edit Settings") || AccessPolicy.EDIT_LEVEL == AccessLevelConst.VIEW,
            "edit level resolved by name (" + AccessPolicy.EDIT_LEVEL + ")");
        boolean levels = AccessPolicy.EDIT_LEVEL != AccessLevelConst.VIEW;
        check(AccessPolicy.decide(AccessPolicy.Target.PAGE, one, editor).canEdit, "Edit + the edit level may edit the page");
        AccessPolicy.Decision v = AccessPolicy.decide(AccessPolicy.Target.PAGE, one, viewer);
        check(!levels || (!v.canEdit && v.reason.contains("View")), "View access is read-only, with the reason (" + v.reason + ")");
        check(!AccessPolicy.decide(AccessPolicy.Target.SCRIPT, one, noRight).canEdit, "a script needs BI Editor-Edit");
        check(AccessPolicy.decide(AccessPolicy.Target.SCRIPT, Collections.emptyList(), editor).canEdit, "a script needs only the right");
        check(AccessPolicy.decide(AccessPolicy.Target.PAGE, one, admin).canEdit, "admin may edit anything");
        check(!AccessPolicy.decide(AccessPolicy.Target.PAGE, one, editor).canUnpublish, "unpublishing needs BI Report-Delete");
        check(!AccessPolicy.decide(AccessPolicy.Target.IMAGE, one, admin).canEdit, "images are not edited here");
        check(AccessPolicy.decide(AccessPolicy.Target.PAGE, one, editor).canEditGadget, "gadget: page editor with BI Report-Edit");
        AccessPolicy.Rights noReportEdit = new AccessPolicy.Rights(false, true, false, false, id -> AccessPolicy.EDIT_LEVEL);
        AccessPolicy.Decision ng = AccessPolicy.decide(AccessPolicy.Target.PAGE, one, noReportEdit);
        check(ng.canEdit && !ng.canEditGadget && ng.gadgetReason.contains("BI Report-Edit"), "gadget needs BI Report-Edit");
        check(!levels || !AccessPolicy.decide(AccessPolicy.Target.PAGE, one, viewer).canEditGadget, "gadget needs the page editable");
        check(!AccessPolicy.decide(AccessPolicy.Target.SCRIPT, one, admin).canEditGadget, "only a page is a gadget");
        List<AccessPolicy.Report> two = Arrays.asList(new AccessPolicy.Report(5, "A"), new AccessPolicy.Report(6, "B"));
        AccessPolicy.Rights mixed = new AccessPolicy.Rights(false, true, true, false, id -> id == 5 ? AccessPolicy.EDIT_LEVEL : AccessLevelConst.VIEW);
        check(!levels || !AccessPolicy.decide(AccessPolicy.Target.PAGE, two, mixed).canEdit, "a shared page needs the edit level on every report");
        // A system app: nobody changes its code; its flags and access follow the rights.
        AccessPolicy.Decision sys = AccessPolicy.decide(AccessPolicy.Target.PAGE, one, admin, true);
        check(!sys.canEdit && sys.reason.equals(AccessPolicy.SYSTEM_REASON), "a system app is locked, for admin too");
        check(sys.canEditFlags && sys.canEditAccess && sys.canUnpublish && sys.canEditGadget, "admin still sets its flags and access");
        AccessPolicy.Decision sysViewer = AccessPolicy.decide(AccessPolicy.Target.PAGE, one, viewer, true);
        check(!sysViewer.canEdit && !sysViewer.canEditFlags, "without edit rights, not even its flags");
        check(AccessPolicy.decide(AccessPolicy.Target.SCRIPT, one, editor, true).canEdit, "only pages are system apps");
        eq(AccessPolicy.validateName("My Report", "x"), "", "a valid name");
        check(!AccessPolicy.validateName("My_Report", "x").isEmpty(), "no underscore");
        check(!AccessPolicy.validateName("My Report", " ").isEmpty(), "a description is required");
    }

    // ------------------------------------------------------------------ template
    private static void template() throws Exception {
        String repo = System.getProperty("reportbtn.repo");
        String[] names = {"List_Report_Template.htm", "Record_Document_Template.htm", "Form_Tool_Template.htm"};
        String text = null;
        for (String file : names) {
            Path tpl = repo == null ? null : Paths.get(repo, "Template", file);
            if (tpl == null || !Files.exists(tpl)) {
                System.out.println("EditorSelfCheck: no " + file + "; its rewrite checks skipped");
                continue;
            }
            String t = new String(Files.readAllBytes(tpl), StandardCharsets.UTF_8);
            text = text == null ? t : text;
            TemplateRewriter.Result r = TemplateRewriter.rewrite(t, "Kit Shortage Board", "Kits short of a component.", "MATERIALS");
            check(r.missed.isEmpty(), file + ": every template rewrite applied (missed: " + r.missed + ")");
            check(r.text.contains("'cdx.bi.kitShortageBoard'"), file + ": storage key");
            check(r.text.contains("name:  'Kit Shortage Board',"), file + ": record name");
            check(r.text.contains("build: 'UNSTAMPED'"), file + ": unstamped build");
            check(r.text.matches("(?s).*<meta charset=\"UTF-8\">\\r?\\n\\s*<meta name=\"fb-launch\" content=\"MATERIALS\">\\r?\\n\\s*<meta name=\"fb-folder\".*"),
                file + ": module tag added after charset, before the folder");
            check(r.text.contains("<meta name=\"description\" content=\"Kits short of a component.\">"), file + ": description");
            check(r.text.contains("<title>Kit Shortage Board</title>"), file + ": title");
            check(r.text.contains("<h1>Kit Shortage Board</h1>"), file + ": heading");
            check(!r.text.matches("(?s).*(fb-folder\"[^>]*>[ \\t]*<!--\\s*TEMPLATE|(key|name):[^\\r\\n]*//\\s*TEMPLATE|</title>[ \\t]*<!--\\s*TEMPLATE|</h1>[ \\t]*<!--\\s*TEMPLATE).*"),
                file + ": no TEMPLATE marker left on a filled-in line");
            check(r.text.contains("TEMPLATE:"), file + ": the author's other TEMPLATE markers stay");
            String none = TemplateRewriter.rewrite(t, "Kit Board", "Kits.", "").text;
            check(!none.contains("name=\"fb-launch\""), file + ": no Apps menus, no module tag");
            check(!none.contains("name=\"fb-origin\""), file + ": no origin tag on a new app");
        }
        if (text == null) {
            System.out.println("EditorSelfCheck: no template; rewrite checks skipped");
            return;
        }
        check(TemplateRewriter.rewrite(text, "Kit Board", "x", "SO").text.contains("const REPORT_TITLE = 'Kit Board';"),
            "List_Report_Template: REPORT_TITLE");
        eq(TemplateRewriter.storageKey("Inventory Valuation Summary by Location Group"), "cdx.bi.inventoryValuationSummar", "key capped at 31");

        // A system app used as a template, and a system app's copy: both come out custom.
        String sys = AppGroups.setOrigin(text, AppGroups.SYSTEM);
        check(!AppGroups.isSystem(TemplateRewriter.rewrite(sys, "Kit Board", "Kits.", "MATERIALS").text), "a template's draft is custom");
        String copy = TemplateRewriter.copyOf(AppGroups.setFolder(sys, "Inventory"), "Kit Board Copy");
        check(!AppGroups.isSystem(copy), "a copy is custom");
        check(copy.contains("'cdx.bi.kitBoardCopy'") && copy.contains("'Kit Board Copy'") && copy.contains("build: 'UNSTAMPED'"),
            "a copy has its own name, key and an unstamped build");
        eq(AppGroups.folderContent(copy), "Inventory", "a copy stays in its folder");
        String longName = TemplateRewriter.copyOf(TemplateRewriter.rewrite(text, "Inventory Valuation Summary by Location Group",
            "x", "PART").text, "Inventory Valuation Summary by Location Group Copy");
        check(longName.contains("'cdx.bi.inventoryValuationSuCopy'"), "a copy's key differs even when both names are cut to 31");
    }

    // ------------------------------------------------------------------ helpers
    private static boolean between(JsIndex.Module m, String path, String startNs, String nextNs) {
        JsIndex.Symbol s = m.find(path), a = m.find(startNs), b = m.find(nextNs);
        if (s == null || a == null || b == null) {
            System.out.println("  (between: " + path + "=" + (s == null ? "-" : s.line) + " " + startNs + "=" + (a == null ? "-" : a.line)
                + " " + nextNs + "=" + (b == null ? "-" : b.line) + ")");
            return false;
        }
        return a.line <= s.line && (b.line > a.line ? s.line < b.line : true);
    }

    private static String kind(JsIndex.Module m, String path) {
        JsIndex.Symbol s = m.find(path);
        return s == null ? "missing" : s.kind.name();
    }

    private static String params(JsIndex.Module m, String path) {
        JsIndex.Symbol s = m.find(path);
        return s == null ? "" : s.params;
    }

    private static String doc(JsIndex.Module m, String path) {
        JsIndex.Symbol s = m.find(path);
        return s == null ? "" : s.doc;
    }

    private static String read(String dir, String file) throws Exception {
        return new String(Files.readAllBytes(Paths.get(dir, file)), StandardCharsets.UTF_8);
    }

    // ------------------------------------------------------------------ Report Builder page
    private static void builderPage() throws Exception {
        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        // User text that a browser or Fishbowl's substitution could misread.
        String hostile = "</script><script>alert(1)</script> {% Script fb-lib %} $SO{x} 100%   O'Brien \\ \"q\"";
        com.fasterxml.jackson.databind.JsonNode spec = om.readTree("{\"kind\":\"fb-report-spec\",\"v\":1,\"subject\":\"sales.posted\",\"title\":"
            + om.writeValueAsString(hostile) + ",\"steps\":[{\"type\":\"table\",\"columns\":[]}]}");
        BuilderPage.Def d = new BuilderPage.Def();
        d.name = "Margin $SO{x} 50% <b>";
        d.key = "cdx.bi.rbTest";
        d.folder = "Custom";
        d.launch = "SO";
        d.description = hostile;
        d.spec = spec;
        d.publishNonce = "abc123";
        String page = BuilderPage.render(d);
        check(!page.contains("$SO{x}"), "builder page: no setting token survives anywhere");
        eq(String.valueOf(count(page, "{% Script fb-lib %}")), "1", "builder page: the one fb-lib include is ours");
        eq(String.valueOf(count(page, "</script>")), String.valueOf(count(page, "<script")), "builder page: user text never closes a script");
        check(page.contains("<meta name=\"fb-builder\" content=\"1; p=abc123\">"), "builder page: the publish nonce is in its tag");
        check(page.contains("<meta name=\"fb-origin\" content=\"custom\">") && page.contains("<meta name=\"fb-launch\" content=\"SO\">"), "builder page: tags");
        check(BuilderPage.isBuilderPage(page) && !AppGroups.isSystem(page), "builder page: recognised, custom");
        eq(BuilderPage.storageKey(page), "cdx.bi.rbTest", "builder page: storage key reads back");
        eq(om.writeValueAsString(BuilderPage.extract(page)), om.writeValueAsString(spec), "builder page: the spec round-trips exactly");
        check(BuilderPage.problem(spec, 100).isEmpty(), "builder page: a spec is publishable");
        check(!BuilderPage.problem(om.readTree("{\"kind\":\"x\"}"), 10).isEmpty(), "builder page: not a spec is refused");
        check(!BuilderPage.problem(spec, BuilderPage.MAX_SPEC + 1).isEmpty(), "builder page: too large is refused");
        check(!page.contains("{\"kind\":\"fb-report-spec\",\"v\":1,\"subject\":\"sales.posted\",\"title\":\"</script>"), "builder page: escaped");
    }

    private static int count(String s, String part) {
        int n = 0;
        for (int i = s.indexOf(part); i >= 0; i = s.indexOf(part, i + part.length())) {
            n++;
        }
        return n;
    }

    private static void check(boolean ok, String what) {
        if (!ok) {
            throw new AssertionError(what);
        }
        passed++;
    }

    private static void eq(String actual, String expected, String what) {
        check(expected.equals(actual), what + "\n  expected: " + expected + "\n  actual:   " + actual);
    }
}
