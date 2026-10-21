package com.fbi.plugins.reportbtn;

import javax.swing.JToolBar;
import java.awt.Component;
import java.util.Map;

/**
 * An optional feature of the Apps (beta) module, found by class name at start-up
 * (ReportWorkspacePlugin.loadExtension). Deleting the feature's package removes it:
 * nothing in the core refers to it by type.
 *
 * Implementations need a public no-argument constructor, and must not extend
 * FishbowlPlugin (the client would load them as a module).
 */
public interface WorkspaceExtension {

    /** Called once, before the workspace's toolbar is handed to the client. */
    void install(WorkspaceHost host, JToolBar toolbar);

    /** openModule('Apps (beta)', 'edit:<id|name>'), with the report already resolved. */
    void edit(WorkspaceHost.ReportRef report);

    /** Extra flags for window.FB_WORKSPACE on a report page (e.g. edit: true). Keys are letters only. */
    Map<String, Boolean> workspaceFlags(int reportId);

    /** The selected tab changed (null when no tab is left). */
    void selectionChanged(Component selected);

    /** The module or client is closing: false cancels (unsaved work the user wants to keep). */
    boolean checkForSave();

    /**
     * openModule('Apps (beta)', 'build:<verb>[:<arg>]'): a request from the Report
     * Builder page (e.g. publish). arg is letters, digits, - and _ only, or null.
     */
    default void build(String verb, String arg) {
        throw new UnsupportedOperationException("The App Builder's publishing isn't part of this build.");
    }

    /**
     * openModule('Apps (beta)', 'drop:<json>'): files dropped on the App Library, as
     * [{"name": "x.htm", "text": "..."}, ...] (only .htm, .html, .js, .css and .json).
     */
    default void dropped(String json) {
        throw new UnsupportedOperationException("The app editor isn't part of this build.");
    }
}
