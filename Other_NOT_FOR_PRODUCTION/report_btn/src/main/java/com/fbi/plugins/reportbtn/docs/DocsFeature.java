package com.fbi.plugins.reportbtn.docs;

import com.fbi.gui.button.FBMainToolbarButton;
import com.fbi.plugins.reportbtn.WorkspaceExtension;
import com.fbi.plugins.reportbtn.WorkspaceHost;

import javax.swing.Icon;
import javax.swing.JToolBar;
import java.awt.Component;
import java.util.Collections;
import java.util.Map;

/**
 * The documents and email proof of concept, loaded by class name like the editor
 * (ReportWorkspacePlugin.loadExtension). It adds "Documents…" to the Apps (beta)
 * ribbon; the Print (App) and Email (rich) buttons in the modules are DocButtons,
 * which the client finds on its own.
 */
public final class DocsFeature implements WorkspaceExtension {

    public DocsFeature() {
    }

    @Override
    public void install(WorkspaceHost host, JToolBar toolbar) {
        Docs.host = host;
        FBMainToolbarButton b = new FBMainToolbarButton();
        b.setText("Documents");
        Icon icon = Docs.icon("/toolbar/printer24.png", 24);
        if (icon != null) {
            b.setIcon(icon);
        }
        b.setToolTipText("Which app each module prints and emails as its document (proof of concept), "
            + "and how your emails are sent");
        b.addActionListener(e -> DefaultsDialog.open(b));
        toolbar.add(WorkspaceHost.ribbonSeparator());
        toolbar.add(b);
    }

    @Override
    public void edit(WorkspaceHost.ReportRef report) {
        // not this feature's
    }

    @Override
    public Map<String, Boolean> workspaceFlags(int reportId) {
        return Collections.emptyMap();
    }

    @Override
    public void selectionChanged(Component selected) {
        // nothing to follow
    }

    @Override
    public boolean checkForSave() {
        return true;
    }
}
