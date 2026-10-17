package com.fbi.plugins.reportbtn;

/**
 * Anything the Apps (beta) module shows in a tab: a report (ReportTab) or a
 * component an extension adds (the page editor).
 */
public interface WorkspaceTab {

    /** Asked before the tab closes (its ×, a middle-click, the module closing). False keeps it open. */
    boolean confirmClose();

    /** Releases what the tab holds (browsers, timers). Called once, after it is removed. */
    void dispose();
}
