package com.fbi.plugins.reportbtn.docs;

import com.fbi.plugins.reportbtn.docs.mail.CssInliner;
import com.fbi.plugins.reportbtn.docs.mail.EmailDraft;
import com.fbi.plugins.reportbtn.docs.mail.EmailTemplates;
import com.fbi.plugins.reportbtn.docs.mail.EmailTokens;
import com.fbi.plugins.reportbtn.docs.mail.MimeBuilder;
import com.fbi.plugins.reportbtn.docs.mail.OwnMailProgram;
import jakarta.mail.BodyPart;
import jakarta.mail.Multipart;
import jakarta.mail.Part;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Properties;

/**
 * The documents PoC's pure helpers, without a client: run by SelfCheck when the docs
 * package is in the build (./build.sh --check).
 */
public final class DocsSelfCheck {

    private static int passed;

    public static void run() throws Exception {
        slots();
        launch();
        templates();
        tokens();
        inliner();
        mime();
        System.out.println("DocsSelfCheck: " + passed + " checks passed");
    }

    private static void slots() {
        eq(String.join(",", DocSlots.moduleNames()),
            "Sales Order,Purchase Order,Picking,Shipping,Work Order,Manufacture Order,Transfer Order,RMA", "modules");
        eq(String.valueOf(DocSlots.all().size()), "13", "slot count");
        eq(DocSlots.slot("sales order invoice").module.name, "Sales Order", "slot lookup ignores case");
        eq(String.valueOf(DocSlots.slot("Sales Order").main()) + DocSlots.slot("Sales Order Invoice").main(), "truefalse", "main slot");
        eq(DocSlots.fileName(DocSlots.slot("Shipping Invoice"), " S10/2? "), "Shipping invoice S10-2-.pdf", "file name");
        eq(DocSlots.fileName(DocSlots.slot("Picking"), null), "Pick ticket.pdf", "file name without number");
        eq(String.valueOf(DocSlots.module("Inventory")), "null", "uncovered module");
    }

    private static void launch() {
        eq(DocumentRenderer.launchJson(DocSlots.slot("Sales Order"), 290, "10042<x>$SO{a}", 41),
            "{\"v\":1,\"host\":\"report_btn\",\"module\":\"SO\",\"moduleName\":\"Sales Order\",\"table\":\"so\",\"id\":290,"
                + "\"num\":\"10042\\u003cx>\\u0024SO{a}\",\"reportId\":41,\"params\":{},\"output\":\"pdf\"}", "FB_LAUNCH for output");
        eq(DocumentRenderer.stateOf("{\"state\":\"ready\",\"pages\":2}"), "ready", "FB_DOC state");
        eq(DocumentRenderer.messageOf("{\"state\":\"error\",\"message\":\"takes \\\"SO\\\" records\"}"), "takes \"SO\" records", "FB_DOC message");
        eq(String.valueOf(DocumentRenderer.stateOf("null")), "null", "no FB_DOC");
        eq(Docs.insertScript("<!-- <head> --><head><title>x</title>", "FB_LAUNCH", "{}"),
            "<!-- <head> --><head><script>window.FB_LAUNCH={};</script><title>x</title>", "insert after the real head");
        eq(Docs.lit("O'Brien\\x"), "'O''Brien\\\\x'", "SQL literal");
    }

    private static void templates() throws Exception {
        EmailTemplates.Template t = EmailTemplates.parse("\uFEFFSUBJECT: Order #@ORDERNUM\r\n<html>\r\n<body>Hi</body>\r\n</html>\r\n", "x");
        eq(t.subject, "Order #@ORDERNUM", "subject line, BOM and CRLF");
        eq(String.valueOf(t.html), "true", "html body");
        eq(t.body, "<html>\n<body>Hi</body>\n</html>", "body without the subject line");
        EmailTemplates.Template p = EmailTemplates.parse("Dear @BILLTONAME,\nThanks & bye <3\n", "y");
        eq(p.subject, "", "no subject line");
        eq(String.valueOf(p.html), "false", "plain body");
        String ph = EmailTemplates.htmlBody(p);
        eq(String.valueOf(ph.contains("Dear @BILLTONAME,<br>Thanks &amp; bye &lt;3")), "true", "plain text escaped with line breaks");
        eq(EmailTemplates.withFooter("<html><body>A</body></html>", "Line 1\nLine <2>"),
            "<html><body>A<br>Line 1<br>Line &lt;2&gt;</body></html>", "footer before the body end");
        eq(EmailTemplates.withFooter("<p>A</p>", ""), "<p>A</p>", "no footer");

        // The stock templates that ship with the client, when this machine has them.
        File dir = new File(System.getProperty("reportbtn.fbhome", "C:/Program Files/Fishbowl"), "client/email-templates");
        for (String f : new String[] {"SO_Template.txt", "PO_Template.txt", "Ship_Template.txt"}) {
            File file = new File(dir, f);
            if (file.isFile()) {
                EmailTemplates.Template s = EmailTemplates.parse(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8), f);
                eq(String.valueOf(!s.subject.isEmpty() || !s.body.isEmpty()), "true", "stock template " + f + " reads");
            }
        }
    }

    private static void tokens() {
        eq(EmailTokens.tracking("UPS", Arrays.asList("1Z1", "1Z2")), "Tracking Number(s) from: UPS: 1Z1, 1Z2", "tracking");
        eq(EmailTokens.tracking("UPS", Arrays.asList()), "", "no tracking");
        Map<String, String> tok = new LinkedHashMap<>();
        tok.put("@ORDERNUM", "10042");
        tok.put("@BILLTONAME", "Smith & Co <AU>");
        eq(EmailTokens.apply("Order @ORDERNUM for @BILLTONAME", tok, false), "Order 10042 for Smith & Co <AU>", "tokens in text");
        eq(EmailTokens.apply("<b>@BILLTONAME</b>", tok, true), "<b>Smith &amp; Co &lt;AU&gt;</b>", "tokens escaped in HTML");
        EmailTokens.Record r = EmailTokens.forRecord((sql, cols) -> {
            Map<String, String> row = new HashMap<>();
            if (sql.contains("FROM so WHERE")) {
                row.put("ordernum", "10042");
                row.put("billto", "Acme");
                row.put("shipto", "Acme Depot");
                row.put("custpo", "PO-7");
                row.put("email", "a@acme.test; b@acme.test");
            } else if (sql.contains("FROM sysuser")) {
                row.put("name", " ");
                row.put("login", "jsmith");
            }
            return row.isEmpty() ? java.util.Collections.emptyList() : java.util.Collections.singletonList(row);
        }, "SO", "so", 290, 7);
        eq(r.tokens.get("@ORDERNUM") + "|" + r.tokens.get("@CUSTOMERPO") + "|" + r.tokens.get("@USER"), "10042|PO-7|jsmith", "SO tokens");
        eq(String.join(",", r.to), "a@acme.test,b@acme.test", "SO recipients");
    }

    private static void inliner() {
        String html = "<!DOCTYPE html><html><head><style>"
            + "/* c */ body { color: #333; } .header { background-color: #27ae60; color: white; padding: 20px }"
            + " p.note { color: red !important } p { color: blue } a:hover { color: pink } th, td { padding: 8px; }"
            + " @media (max-width:600px) { .header { padding: 4px } }"
            + " .bg { background: url(data:image/png;base64,AA==); }"
            + "</style></head><body><div class=\"header\" style=\"padding: 2px\">H</div>"
            + "<p class=\"note\" style=\"color: green\">N</p><table><tr><th>A</th><td>B</td></tr></table><i class=\"bg\">x</i></body></html>";
        String out = CssInliner.inline(html);
        has(out, "<div class=\"header\" style=\"background-color: #27ae60; color: white; padding: 2px;\">", "class rule, own style wins");
        has(out, "<p class=\"note\" style=\"color: red !important;\">", "!important beats the own style");
        has(out, "<th style=\"padding: 8px;\">", "selector list");
        has(out, "<body style=\"color: #333;\">", "body rule");
        has(out, "url(data:image/png;base64,AA==)", "semicolons inside url() kept");
        has(out, "@media (max-width:600px)", "style block kept");
        eq(String.valueOf(out.contains("pink")), "true", "hover rule stays in the block only");
        eq(String.valueOf(out.contains("style=\"color: pink")), "false", "hover rule not inlined");
        eq(String.valueOf(CssInliner.inline("<p>x</p>").contains("<p>x</p>")), "true", "no style sheet: unchanged");
    }

    private static void mime() throws Exception {
        File pdf = File.createTempFile("Sales order 10042", ".pdf");
        Files.write(pdf.toPath(), "%PDF-1.4\n%%EOF\n".getBytes(StandardCharsets.ISO_8859_1));
        pdf.deleteOnExit();
        EmailDraft d = new EmailDraft();
        d.to.add("a@acme.test");
        d.cc.addAll(EmailDraft.split("b@acme.test; ,c@acme.test"));
        d.subject = "Order 10042 – thanks";
        d.html = "<html><head><style>p{color:red}</style></head><body><p>Hi<br>there</p>"
            + "<img src=\"data:image/png;base64,iVBORw0KGgo=\"></body></html>";
        d.attachments.add(pdf);
        MimeMessage m = MimeBuilder.build(Session.getInstance(new Properties()), d, null, false);
        eq(m.getContentType().split(";")[0].trim().toLowerCase(), "multipart/mixed", "top is mixed");
        Multipart mixed = (Multipart) m.getContent();
        eq(String.valueOf(mixed.getCount()), "2", "body + one attachment");
        Multipart alt = (Multipart) mixed.getBodyPart(0).getContent();
        eq(type(alt.getBodyPart(0)) + "," + type(alt.getBodyPart(1)), "text/plain,multipart/related", "alternative: text then related");
        eq(String.valueOf(alt.getBodyPart(0).getContent()), "Hi\nthere", "plain text keeps the line break");
        Multipart rel = (Multipart) alt.getBodyPart(1).getContent();
        String htmlPart = String.valueOf(rel.getBodyPart(0).getContent());
        eq(String.valueOf(htmlPart.contains("<p style=\"color: red;\">") && htmlPart.contains("src=\"cid:img1.")), "true", "inlined CSS and cid image");
        eq(type(rel.getBodyPart(1)), "image/png", "inline image part");
        BodyPart att = mixed.getBodyPart(1);
        eq(String.valueOf(Part.ATTACHMENT.equalsIgnoreCase(att.getDisposition())), "true", "attachment disposition");
        eq(String.valueOf(att.getFileName().endsWith(".pdf")), "true", "attachment name");
        eq(String.valueOf(m.getRecipients(jakarta.mail.Message.RecipientType.CC).length), "2", "cc split");

        File eml = File.createTempFile("draft", ".eml");
        eml.deleteOnExit();
        MimeBuilder.writeDraft(d, eml);
        String raw = new String(Files.readAllBytes(eml.toPath()), StandardCharsets.ISO_8859_1);
        eq(String.valueOf(raw.startsWith("X-Unsent: 1\r\n")), "true", "draft marked unsent on its first line");
        eq(String.valueOf(raw.contains("\nMessage-ID: <")), "true", "draft has a Message-ID");
        eq(String.valueOf(raw.contains("\nFrom:") || raw.startsWith("From:")), "false", "draft has no From");
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        m.writeTo(b);
        eq(String.valueOf(b.toString("ISO-8859-1").contains("Subject: =?UTF-8?")), "true", "subject encoded");
        mailProgram();
    }

    /** Which program the own-email hand-off picks, from the user's default mailto: handler. */
    private static void mailProgram() {
        String aumid = "Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows";
        eq(String.valueOf(OwnMailProgram.classify("AppXbx2ce4", true, true, aumid)), "NEW_OUTLOOK",
            "new Outlook as the default, classic installed too");
        eq(String.valueOf(OwnMailProgram.classify("Outlook.URL.mailto.15", true, true, null)), "CLASSIC_OUTLOOK", "classic as the default");
        eq(String.valueOf(OwnMailProgram.classify(null, true, false, null)), "CLASSIC_OUTLOOK", "no choice made, classic installed");
        eq(String.valueOf(OwnMailProgram.classify("Thunderbird.Url.mailto", true, true, null)), "OTHER", "another program");
        eq(String.valueOf(OwnMailProgram.classify("AppXbx2ce4", false, false, aumid)), "OTHER", "new Outlook's id without its command");
        eq(OwnMailProgram.parseRegValue("\r\nHKEY_CURRENT_USER\\Software\\x\r\n    ProgId    REG_SZ    AppXbx2ce4vcxjdhff3d1ms66qqzk12zn827\r\n\r\n", "ProgId"),
            "AppXbx2ce4vcxjdhff3d1ms66qqzk12zn827", "reg query output");
        eq(String.valueOf(OwnMailProgram.parseRegValue("ERROR: The system was unable to find the specified registry key", "ProgId")), "null", "no value");
    }

    private static String type(BodyPart p) throws Exception {
        return p.getContentType().split(";")[0].trim().toLowerCase();
    }

    private static void has(String text, String part, String what) {
        if (!text.contains(part)) {
            System.out.println("FAIL " + what + "\n  expected to contain: " + part + "\n  in: " + text);
            System.exit(1);
        }
        passed++;
    }

    private static void eq(String actual, String expected, String what) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            System.out.println("FAIL " + what + "\n  expected: " + expected + "\n  actual:   " + actual);
            System.exit(1);
        }
        passed++;
    }
}
