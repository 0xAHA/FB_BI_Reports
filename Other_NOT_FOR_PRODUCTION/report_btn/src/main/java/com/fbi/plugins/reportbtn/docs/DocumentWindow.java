package com.fbi.plugins.reportbtn.docs;

import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.client.modules.bireport.panels.BiBrowserPanel;
import com.fbi.plugins.reportbtn.BrowserFit;
import com.fbi.plugins.reportbtn.WorkspaceHost;

import javax.swing.BorderFactory;
import javax.swing.Icon;
import javax.swing.JButton;
import javax.swing.JFrame;
import javax.swing.JToolBar;
import javax.swing.WindowConstants;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dialog;
import java.awt.Dimension;
import java.awt.Frame;
import java.awt.Insets;
import java.awt.Window;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.File;

/**
 * Print (App): the record's document on screen, like Jasper's report viewer, with
 * Print, Save PDF and Email. The page is the app in document output (its pages
 * only); Print and Save PDF are the BI Reports module's own, Email opens the rich
 * email window with the same PDF.
 */
final class DocumentWindow extends JFrame {

    private final BiBrowserPanel panel = new BiBrowserPanel();
    private final DocSlots.Slot slot;
    private final int recordId;
    private final String num;

    private DocumentWindow(WorkspaceHost host, ClientModuleImpl module, DocSlots.Slot slot, WorkspaceHost.Page page,
                           int recordId, String num) {
        super(slot.title + (Docs.blank(num) ? "" : " " + num) + " - " + page.name);
        this.slot = slot;
        this.recordId = recordId;
        this.num = num;
        setModalExclusionType(Dialog.ModalExclusionType.APPLICATION_EXCLUDE);
        setDefaultCloseOperation(WindowConstants.DISPOSE_ON_CLOSE);
        Window owner = Docs.window(module);
        if (owner instanceof Frame && ((Frame) owner).getIconImages() != null) {
            setIconImages(((Frame) owner).getIconImages());
        }

        JToolBar bar = new JToolBar();
        bar.setFloatable(false);
        bar.setBorder(BorderFactory.createEmptyBorder(2, 4, 2, 4));
        tool(bar, "Print", "/toolbar/printer24.png", "Print the document", this::print);
        tool(bar, "Save PDF", "/toolbar/save24.png", "Save the document as a PDF file", this::savePdf);
        tool(bar, "Email", "/toolbar/email24.png", "Email the document as a PDF", this::email);
        bar.addSeparator();
        tool(bar, "Reload", "/toolbar/refresh24.png", "Load the document again", () -> load(page, host));

        panel.init(host.plugin(), false);
        try {
            Docs.call(panel, "showButtons", new Class<?>[] {boolean.class}, false);   // ours replace the native row
        } catch (Exception e) {
            Docs.log("hiding the native buttons failed", e);
        }
        getContentPane().setLayout(new BorderLayout());
        getContentPane().add(bar, BorderLayout.NORTH);
        getContentPane().add(panel, BorderLayout.CENTER);
        BrowserFit.attach(panel);
        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosed(WindowEvent e) {
                try {
                    panel.dispose();
                } catch (RuntimeException ignored) {
                    // closing anyway
                }
            }
        });
        Dimension size = owner != null && owner.getWidth() > 400
            ? new Dimension(owner.getWidth() * 4 / 5, owner.getHeight() * 4 / 5) : new Dimension(1100, 860);
        setSize(size);
        setLocationRelativeTo(owner);
        load(page, null);
    }

    /** Opens the slot's app on the record. */
    static void open(Component parent, ClientModuleImpl module, DocSlots.Slot slot, String appName, int recordId, String num) {
        WorkspaceHost host = Docs.hostOrExplain(parent);
        if (host == null) {
            return;
        }
        WorkspaceHost.ReportRef ref = DocumentRenderer.appRef(parent, host, slot, appName);
        if (ref == null) {
            return;
        }
        try {
            WorkspaceHost.Page page = host.loadPage(ref.id, ref.name);
            DocumentWindow w = new DocumentWindow(host, module, slot, page, recordId, num);
            w.setVisible(true);
        } catch (Exception e) {
            Docs.log("opening " + appName + " failed", e);
            Docs.error(parent, e.getMessage());
        }
    }

    /** Loads the page; host non-null re-reads it from Fishbowl first (Reload). */
    private void load(WorkspaceHost.Page page, WorkspaceHost host) {
        WorkspaceHost.Page p = page;
        if (host != null) {
            try {
                p = host.loadPage(page.id, page.name);
            } catch (Exception e) {
                Docs.error(this, e.getMessage());
                return;
            }
        }
        String html = Docs.insertScript(p.html, "FB_LAUNCH", DocumentRenderer.launchJson(slot, recordId, num, p.id));
        panel.clear();
        panel.loadHTML(html, p.id, p.name, false, p.params);
        BrowserFit.afterLoad(panel);
    }

    private void print() {
        native_("btnPrintActionPerformed");
    }

    private void savePdf() {
        native_("btnSaveActionPerformed");
    }

    private void native_(String method) {
        try {
            Docs.call(panel, method, new Class<?>[0]);
        } catch (Exception e) {
            Docs.log(method + " failed", e);
            Docs.error(this, "That didn't work: " + e.getMessage());
        }
    }

    private void email() {
        try {
            File pdf = (File) Docs.call(panel, "saveReportFile", new Class<?>[] {boolean.class}, true);
            if (pdf == null) {
                return;   // the panel has shown why
            }
            EmailFlow.start(this, slot, recordId, num, DocumentRenderer.finish(pdf, slot, num));
        } catch (Exception e) {
            Docs.log("emailing from the viewer failed", e);
            Docs.error(this, "The PDF couldn't be made: " + e.getMessage());
        }
    }

    private static void tool(JToolBar bar, String text, String icon, String tip, Runnable action) {
        JButton b = new JButton(text);
        Icon i = Docs.icon(icon, 16);
        if (i != null) {
            b.setIcon(i);
        }
        b.setToolTipText(tip);
        b.setFocusable(false);
        b.setMargin(new Insets(2, 6, 2, 6));
        b.addActionListener(e -> action.run());
        bar.add(b);
    }
}
