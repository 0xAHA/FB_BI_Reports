package com.fbi.plugins.reportbtn.docs.mail;

import java.awt.Desktop;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.concurrent.TimeUnit;

/**
 * Hands a draft to the user's own email program, with its body and attachments.
 * Which program: the one Windows uses for mailto: links (the user's default email
 * app), not merely whatever is installed.
 *
 * Classic Outlook: through its COM interface, from a short PowerShell script. Its
 * main window is opened too when it isn't running, because a classic Outlook started
 * only for automation closes with the email window and leaves the sent email in its
 * Outbox (in cached mode it sends only while open).
 *
 * New Outlook: it has no COM or MAPI, but opens a .eml file marked unsent
 * (X-Unsent: 1) as an editable draft. The file is handed to it through its own
 * command (olk.exe), because .eml files may still be associated with classic Outlook.
 *
 * Anything else: the .eml draft, opened with the program Windows uses for .eml
 * files; some open it read-only, with Forward or "Edit as new" to send it.
 * mailto: links can't carry attachments or HTML, so they aren't used.
 */
public final class OwnMailProgram {

    /** The user's default email app, as far as the hand-off is concerned. */
    public enum Program { CLASSIC_OUTLOOK, NEW_OUTLOOK, OTHER }

    private static final String MAILTO_CHOICE = "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\mailto\\UserChoice";

    private OwnMailProgram() {
    }

    /** Opens the draft; returns what happened, in a line for the user. */
    public static String open(EmailDraft d) throws Exception {
        Program program = defaultProgram();
        if (program == Program.CLASSIC_OUTLOOK) {
            try {
                outlook(d);
                return "The email is open in Outlook, with the attachment.";
            } catch (Exception e) {
                System.err.println("[report_btn docs] Outlook didn't take the email, trying a draft file: " + e.getMessage());
            }
        }
        File eml = draftFile(d);
        File olk = newOutlook();
        if (program == Program.NEW_OUTLOOK && olk != null) {
            new ProcessBuilder(olk.getAbsolutePath(), eml.getAbsolutePath()).redirectErrorStream(true).start();
            return "The email opened in Outlook as a draft, with the attachment.";
        }
        if (!Desktop.isDesktopSupported()) {
            throw new Exception("Windows can't open the draft here. It was saved as " + eml.getAbsolutePath());
        }
        Desktop.getDesktop().open(eml);
        return "The email opened in your email program as a draft (" + eml.getName() + ").";
    }

    /** The .eml draft, in a folder of its own, named after the subject. */
    private static File draftFile(EmailDraft d) throws Exception {
        File dir = Files.createTempDirectory("fbmail").toFile();
        String name = (MailSettings.blank(d.subject) ? "Email" : d.subject).replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-").trim();
        if (name.length() > 80) {
            name = name.substring(0, 80).trim();
        }
        File eml = new File(dir, (name.isEmpty() ? "Email" : name) + ".eml");
        MimeBuilder.writeDraft(d, eml);
        eml.deleteOnExit();
        dir.deleteOnExit();
        return eml;
    }

    /** Which program takes mailto: links for this user. */
    static Program defaultProgram() {
        String progId = regValue(MAILTO_CHOICE, "ProgId");
        boolean classic = outlookInstalled();
        return classify(progId, classic, newOutlook() != null,
            progId != null && progId.startsWith("AppX") ? regValue("HKCR\\" + progId + "\\Application", "AppUserModelID") : null);
    }

    /** The decision itself, for the self-check: mailto ProgId, classic Outlook registered, olk.exe present, the AppX app id. */
    public static Program classify(String mailtoProgId, boolean classicInstalled, boolean newInstalled, String appUserModelId) {
        if (mailtoProgId == null || mailtoProgId.isEmpty()) {
            // No choice made: Windows falls back to the registered client, classic Outlook when it is installed.
            return classicInstalled ? Program.CLASSIC_OUTLOOK : Program.OTHER;
        }
        if (mailtoProgId.toLowerCase().startsWith("outlook.url.mailto")) {
            return classicInstalled ? Program.CLASSIC_OUTLOOK : Program.OTHER;
        }
        if (newInstalled && appUserModelId != null && appUserModelId.toLowerCase().contains("outlookforwindows")) {
            return Program.NEW_OUTLOOK;
        }
        return Program.OTHER;
    }

    /**
     * New Outlook's command (an app execution alias), when it is installed. The alias is
     * a reparse point File.exists() can't read, so the folder's listing decides.
     */
    static File newOutlook() {
        String local = System.getenv("LOCALAPPDATA");
        File dir = local == null ? null : new File(local, "Microsoft\\WindowsApps");
        String[] names = dir == null ? null : dir.list();
        if (names != null) {
            for (String n : names) {
                if (n.equalsIgnoreCase("olk.exe")) {
                    return new File(dir, n);
                }
            }
        }
        return null;
    }

    /** Classic Outlook registers Outlook.Application; new Outlook and other programs don't. */
    static boolean outlookInstalled() {
        try {
            Process p = new ProcessBuilder("reg", "query", "HKCR\\Outlook.Application\\CLSID").redirectErrorStream(true).start();
            drain(p.getInputStream());
            return p.waitFor(10, TimeUnit.SECONDS) && p.exitValue() == 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** A registry string value, or null. */
    static String regValue(String key, String name) {
        try {
            Process p = new ProcessBuilder("reg", "query", key, "/v", name).redirectErrorStream(true).start();
            String out = drain(p.getInputStream());
            if (!p.waitFor(10, TimeUnit.SECONDS) || p.exitValue() != 0) {
                return null;
            }
            return parseRegValue(out, name);
        } catch (Exception e) {
            return null;
        }
    }

    /** The value from `reg query … /v name` output ("    name    REG_SZ    value"), or null. */
    public static String parseRegValue(String output, String name) {
        for (String line : output.split("\r?\n")) {
            String t = line.trim();
            if (t.regionMatches(true, 0, name, 0, name.length())) {
                String[] parts = t.split("\\s{2,}|\\t", 3);
                if (parts.length == 3 && parts[0].equalsIgnoreCase(name) && parts[1].startsWith("REG_")) {
                    return parts[2].trim();
                }
            }
        }
        return null;
    }

    private static void outlook(EmailDraft d) throws Exception {
        File dir = Files.createTempDirectory("fbmail").toFile();
        File body = new File(dir, "body.html");
        Files.write(body.toPath(), CssInliner.inline(d.html).getBytes(StandardCharsets.UTF_8));
        StringBuilder ps = new StringBuilder();
        ps.append("$ErrorActionPreference = 'Stop'\r\n");
        ps.append("$o = New-Object -ComObject Outlook.Application\r\n");
        // Started just for this, Outlook would close with the email window and keep the email in its Outbox.
        ps.append("if ($o.Explorers.Count -eq 0) { $o.GetNamespace('MAPI').GetDefaultFolder(6).Display() }\r\n");
        ps.append("$m = $o.CreateItem(0)\r\n");
        ps.append("$m.To = ").append(q(EmailDraft.join(d.to))).append("\r\n");
        ps.append("$m.CC = ").append(q(EmailDraft.join(d.cc))).append("\r\n");
        ps.append("$m.BCC = ").append(q(EmailDraft.join(d.bcc))).append("\r\n");
        ps.append("$m.Subject = ").append(q(d.subject)).append("\r\n");
        ps.append("$m.HTMLBody = [System.IO.File]::ReadAllText(").append(q(body.getAbsolutePath()))
            .append(", [System.Text.Encoding]::UTF8)\r\n");
        for (File f : d.attachments) {
            ps.append("$m.Attachments.Add(").append(q(f.getAbsolutePath())).append(") | Out-Null\r\n");
        }
        ps.append("$m.Display()\r\n");
        File script = new File(dir, "open.ps1");
        // A BOM, so Windows PowerShell reads the script as UTF-8 (names and subjects with accents).
        byte[] text = ps.toString().getBytes(StandardCharsets.UTF_8);
        byte[] withBom = new byte[text.length + 3];
        withBom[0] = (byte) 0xEF;
        withBom[1] = (byte) 0xBB;
        withBom[2] = (byte) 0xBF;
        System.arraycopy(text, 0, withBom, 3, text.length);
        Files.write(script.toPath(), withBom);

        Process p = new ProcessBuilder("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
            "-File", script.getAbsolutePath()).redirectErrorStream(true).start();
        String out = drain(p.getInputStream());
        if (!p.waitFor(60, TimeUnit.SECONDS)) {
            p.destroy();
            throw new Exception("Outlook didn't answer within a minute.");
        }
        if (p.exitValue() != 0) {
            throw new Exception(out.trim().isEmpty() ? "exit code " + p.exitValue() : out.trim());
        }
        script.deleteOnExit();
        body.deleteOnExit();
        dir.deleteOnExit();
    }

    /** A PowerShell single-quoted string. */
    static String q(String s) {
        return "'" + (s == null ? "" : s.replace("'", "''").replace("\r", " ").replace("\n", " ")) + "'";
    }

    private static String drain(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        for (int n; (n = in.read(buf)) > 0; ) {
            b.write(buf, 0, n);
        }
        return b.toString(StandardCharsets.UTF_8.name());
    }
}
