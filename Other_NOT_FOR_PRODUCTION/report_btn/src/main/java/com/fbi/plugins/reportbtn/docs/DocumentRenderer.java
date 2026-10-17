package com.fbi.plugins.reportbtn.docs;

import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.client.modules.bireport.panels.BiBrowserPanel;
import com.evnt.common.ReportViewer;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.util.FishbowlBrowser;

import javax.swing.JWindow;
import javax.swing.SwingUtilities;
import javax.swing.SwingWorker;
import java.awt.BorderLayout;
import java.awt.Component;
import java.io.File;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Makes a module document's PDF.
 *
 * An app: the page is loaded as the BI Reports module loads it, with FB_LAUNCH
 * naming the record and asking for output 'pdf' (docs/launch-context.md §6), into the
 * native BiBrowserPanel in a window off the screen. Once the page reports
 * window.FB_DOC ready, the panel's own Save→PDF writes the file: the print path the
 * documents' sheets are sized for.
 *
 * A Jasper report: the module's own report viewer, as the stock Email does
 * (loadReport with the module's getReportInfo(), then save as pdf).
 */
final class DocumentRenderer {

    private static final int WAIT_MS = 30000;
    private static final Pattern STATE = Pattern.compile("\"state\"\\s*:\\s*\"(\\w+)\"");
    private static final Pattern MESSAGE = Pattern.compile("\"message\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");

    private DocumentRenderer() {
    }

    /** FB_LAUNCH for a document: the record, and output 'pdf'. */
    static String launchJson(DocSlots.Slot slot, int recordId, String num, int reportId) {
        DocSlots.Module m = slot.module;
        return "{\"v\":1,\"host\":\"report_btn\",\"module\":" + Docs.json(m.code)
            + ",\"moduleName\":" + Docs.json(m.name)
            + ",\"table\":" + Docs.json(m.table)
            + ",\"id\":" + recordId
            + (Docs.blank(num) ? "" : ",\"num\":" + Docs.json(num.trim()))
            + ",\"reportId\":" + reportId
            + ",\"params\":{},\"output\":\"pdf\"}";
    }

    /** The app named for this slot, if the user may open it; else null after a message. */
    static WorkspaceHost.ReportRef appRef(Component parent, WorkspaceHost host, DocSlots.Slot slot, String appName) {
        WorkspaceHost.ReportRef ref = host.findReport(0, appName);
        if (ref == null) {
            Docs.error(parent, "The app \"" + appName + "\" is set as the " + slot.title.toLowerCase()
                + " document, but it doesn't exist or you don't have access to it.");
        }
        return ref;
    }

    /**
     * The app's PDF for one record. Shows "Preparing…" and returns at once; done gets the
     * file on the event thread. Failures are shown to the user.
     */
    static void app(Component parent, DocSlots.Slot slot, String appName, int recordId, String num, Consumer<File> done) {
        WorkspaceHost host = Docs.hostOrExplain(parent);
        if (host == null) {
            return;
        }
        WorkspaceHost.ReportRef ref = appRef(parent, host, slot, appName);
        if (ref == null) {
            return;
        }
        WorkspaceHost.Page page;
        try {
            page = host.loadPage(ref.id, ref.name);
        } catch (Exception e) {
            Docs.error(parent, e.getMessage());
            return;
        }
        String html = Docs.insertScript(page.html, "FB_LAUNCH", launchJson(slot, recordId, num, page.id));

        Docs.Busy busy = new Docs.Busy(parent, "Preparing the " + slot.title.toLowerCase() + (Docs.blank(num) ? "" : " " + num) + "…");
        JWindow offscreen = new JWindow(Docs.window(parent));
        BiBrowserPanel panel = new BiBrowserPanel();
        try {
            panel.init(host.plugin(), false);
            offscreen.getContentPane().add(panel, BorderLayout.CENTER);
            offscreen.setFocusableWindowState(false);
            offscreen.setBounds(-20000, -20000, 1280, 1000);
            offscreen.setVisible(true);
            panel.loadHTML(html, page.id, page.name, false, page.params);
        } catch (RuntimeException e) {
            busy.close();
            dispose(panel, offscreen);
            Docs.log("rendering " + appName + " failed", e);
            Docs.error(parent, "The " + slot.title.toLowerCase() + " couldn't be prepared: " + e);
            return;
        }

        new SwingWorker<File, Void>() {
            @Override
            protected File doInBackground() throws Exception {
                FishbowlBrowser browser = (FishbowlBrowser) Docs.field(panel, "browser");
                String why = waitReady(browser);
                if (why != null) {
                    throw new Exception(why);
                }
                File written = (File) Docs.call(panel, "saveReportFile", new Class<?>[] {boolean.class}, true);
                if (written == null) {
                    throw new Exception("Fishbowl didn't write the PDF.");
                }
                return finish(written, slot, num);
            }

            @Override
            protected void done() {
                busy.close();
                dispose(panel, offscreen);
                try {
                    done.accept(get());
                } catch (java.util.concurrent.ExecutionException e) {
                    Throwable t = e.getCause() != null ? e.getCause() : e;
                    Docs.log("rendering " + appName + " failed", t);
                    Docs.error(parent, "The " + slot.title.toLowerCase() + " couldn't be prepared: " + t.getMessage());
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }.execute();
    }

    /** Null once the page says ready; otherwise why not (its own message, or a timeout). */
    private static String waitReady(FishbowlBrowser browser) throws InterruptedException {
        long end = System.currentTimeMillis() + WAIT_MS;
        String last = null;
        while (System.currentTimeMillis() < end) {
            Object r = null;
            try {
                r = browser.executeJs("(function(){try{return JSON.stringify(window.FB_DOC||null);}catch(e){return null;}})()");
            } catch (RuntimeException ignored) {
                // still loading
            }
            String s = r == null ? null : String.valueOf(r);
            last = s;
            String state = stateOf(s);
            if ("ready".equals(state)) {
                Thread.sleep(150);   // let the last paint settle before printing
                return null;
            }
            if ("error".equals(state)) {
                String msg = messageOf(s);
                return Docs.blank(msg) ? "the app reported an error." : msg;
            }
            Thread.sleep(200);
        }
        return last == null || "null".equals(last)
            ? "the app didn't take part in document output (no window.FB_DOC). Only apps built on fb-doc can stand in for a module document."
            : "the app didn't finish within " + (WAIT_MS / 1000) + " seconds.";
    }

    static String stateOf(String json) {
        if (json == null) {
            return null;
        }
        Matcher m = STATE.matcher(json);
        return m.find() ? m.group(1) : null;
    }

    static String messageOf(String json) {
        Matcher m = json == null ? null : MESSAGE.matcher(json);
        return m != null && m.find() ? m.group(1).replace("\\\"", "\"").replace("\\\\", "\\") : null;
    }

    /** A PDF the native save wrote: once it is complete, under the attachment's name. */
    static File finish(File written, DocSlots.Slot slot, String num) throws Exception {
        waitWritten(written);
        return named(written.toPath(), DocSlots.fileName(slot, num));
    }

    /** The native save releases its wait before the PDF is closed: wait for a complete file. */
    private static void waitWritten(File f) throws Exception {
        long end = System.currentTimeMillis() + 10000, lastSize = -1;
        while (System.currentTimeMillis() < end) {
            long size = f.length();
            if (size > 0 && size == lastSize && endsWithEof(f)) {
                return;
            }
            lastSize = size;
            Thread.sleep(200);
        }
        if (f.length() == 0) {
            throw new Exception("the PDF came out empty.");
        }
    }

    private static boolean endsWithEof(File f) {
        try (RandomAccessFile raf = new RandomAccessFile(f, "r")) {
            long len = raf.length();
            int n = (int) Math.min(1024, len);
            byte[] tail = new byte[n];
            raf.seek(len - n);
            raf.readFully(tail);
            return new String(tail, StandardCharsets.ISO_8859_1).contains("%%EOF");
        } catch (Exception e) {
            return false;
        }
    }

    /** Moves the file to a folder of its own under the given name (the attachment's name). */
    static File named(Path from, String name) throws Exception {
        Path dir = Files.createTempDirectory("fbdocs");
        Path to = dir.resolve(name);
        Files.move(from, to, StandardCopyOption.REPLACE_EXISTING);
        to.toFile().deleteOnExit();
        dir.toFile().deleteOnExit();
        return to.toFile();
    }

    private static void dispose(BiBrowserPanel panel, JWindow window) {
        SwingUtilities.invokeLater(() -> {
            try {
                panel.dispose();
            } catch (RuntimeException ignored) {
                // closing anyway
            }
            window.dispose();
        });
    }

    /**
     * The slot's Jasper report (Module Options) for the module's open record, as the
     * stock Email makes it. Event thread. Throws with a message ready to show.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    static File jasper(ClientModuleImpl module, DocSlots.Slot slot, String num) throws Exception {
        Object v = Docs.field(module, "reportViewer");
        if (!(v instanceof ReportViewer)) {
            throw new Exception("This module has no report viewer to make its Jasper document with.");
        }
        ReportViewer viewer = (ReportViewer) v;
        Map info = module.getReportInfo();
        boolean loaded;
        try {
            loaded = viewer.loadReport(slot.name, info == null ? new HashMap() : info, null);
        } catch (NullPointerException e) {
            loaded = viewer.loadReport(slot.name, info == null ? new HashMap() : info, new HashMap());
        }
        if (!loaded) {
            throw new Exception("No Jasper report is set for \"" + slot.name + "\" (Reporting › Module Options).");
        }
        File tmp = File.createTempFile("rep", ".pdf");
        viewer.save(tmp.getAbsolutePath(), "pdf");
        if (tmp.length() == 0) {
            throw new Exception("The Jasper report came out empty.");
        }
        return named(tmp.toPath(), DocSlots.fileName(slot, num));
    }
}
