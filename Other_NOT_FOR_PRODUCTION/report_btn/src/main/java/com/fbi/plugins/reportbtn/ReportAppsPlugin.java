package com.fbi.plugins.reportbtn;

import com.fbi.plugins.FishbowlPlugin;
import com.fbi.sdk.constants.MenuGroupNameConst;

import javax.swing.SwingUtilities;

/**
 * report_btn (proof of concept).
 *
 * Adds an "Apps" section to the bottom of the current module's Reports menu,
 * listing the BI reports that declare that module (an fb-launch meta tag in the
 * report page). Choosing one opens it in its own window with the module's
 * current record passed in as window.FB_LAUNCH.
 * Spec: Other_NOT_FOR_PRODUCTION/Paperwork_POC/LAUNCH_CONTEXT.md.
 *
 * This class is only the bootstrap. The client instantiates every FishbowlPlugin
 * at login (Client.loadModules), so the constructor hooks the Reports menu; the
 * module itself never appears in the navigation.
 */
public class ReportAppsPlugin extends FishbowlPlugin {

    static final String MODULE_NAME = "Report Apps";

    // The newest instance: a re-login builds a new one with a fresh EVE manager.
    private static volatile ReportAppsPlugin current;

    public ReportAppsPlugin() {
        setModuleName(MODULE_NAME);
        setMenuGroup(MenuGroupNameConst.INTEGRATIONS);
        current = this;
        SwingUtilities.invokeLater(ReportAppsMenu::install);
    }

    @Override
    public boolean shouldShow() {
        return false;
    }

    static ReportAppsPlugin current() {
        return current;
    }

    static void log(String message) {
        System.out.println("[report_btn] " + message);
    }

    static void log(String message, Throwable t) {
        System.out.println("[report_btn] " + message + ": " + t);
    }
}
