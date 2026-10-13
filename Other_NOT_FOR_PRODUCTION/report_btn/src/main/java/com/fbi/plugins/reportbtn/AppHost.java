package com.fbi.plugins.reportbtn;

/**
 * Somewhere an app (a ReportTab) lives outside the Apps (beta) module's tabs: its
 * own main client tab (AppModule) or its own window (AppWindow). The workspace
 * keeps a list of them, so a saved page reloads there too.
 */
interface AppHost {

    /** The app shown, or null once it has moved on. */
    ReportTab tab();

    /** After Back, Forward or a reload: titles and buttons. */
    void changed();
}
