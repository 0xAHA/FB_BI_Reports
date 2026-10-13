package com.fbi.plugins.reportbtn;

import com.evnt.eve.event.EVEvent;
import com.fbi.fbdata.QueryParameter;
import com.fbi.fbdata.bi.BiReportFpo;
import com.fbi.plugins.FishbowlPlugin;

import javax.swing.Icon;
import java.util.Collection;
import java.util.Set;

/**
 * What the Apps (beta) module offers an extension. Implemented by the workspace
 * itself; everything here runs on the event thread unless it says otherwise.
 */
public interface WorkspaceHost {

    /**
     * A divider for the module ribbon, made as the client makes its own (a vertical
     * JSeparator up to 10 x 50), so the Apps (beta) ribbon is as tall as every
     * other module's and doesn't jump when switching modules.
     */
    static javax.swing.JComponent ribbonSeparator() {
        javax.swing.JSeparator s = new javax.swing.JSeparator(javax.swing.SwingConstants.VERTICAL);
        s.setMaximumSize(new java.awt.Dimension(10, 50));
        return s;
    }

    /** A report the user may open (from the access-filtered catalog). */
    final class ReportRef {
        public final int id;
        public final String name;

        public ReportRef(int id, String name) {
            this.id = id;
            this.name = name;
        }
    }

    /** The workspace module: runQuery, the user, and the module a BiBrowserPanel is initialised with. */
    FishbowlPlugin plugin();

    void addTab(WorkspaceTab tab, String title, String tip, Icon icon);

    void retitle(WorkspaceTab tab, String title, String tip);

    void select(WorkspaceTab tab);

    /** Closes the tab after its confirmClose(). */
    void closeTab(WorkspaceTab tab);

    /** The tabs an extension added that are still open, of the given class. */
    <T extends WorkspaceTab> java.util.List<T> tabs(Class<T> type);

    /** A report by id (or name when id is 0), if the user may open it; else null. */
    ReportRef findReport(int id, String name);

    /** The report in the selected tab, or null when that tab isn't a report. */
    ReportRef selectedReport();

    void openReport(int reportId, boolean newTab);

    /** Reloads the open report tabs showing these reports (null: every report tab), keeping their history. */
    void reloadReports(Collection<Integer> reportIds);

    /** Forgets the cached report list, so a new or changed report shows at once. */
    void invalidateCatalog();

    /** Null when the reply is a success; otherwise a message ready to show. Any thread. */
    String serverError(EVEvent reply);

    /** The report's saved setting values, as the BI Reports module passes them to loadHTML. */
    Set<QueryParameter> savedParams(BiReportFpo report);

    /** Runs a SELECT through the workspace module; never null. Any thread. */
    java.util.List<?> query(String sql);

    /** A query-result column, matched without regard to case. */
    String column(Object row, String name);

    /** The signed-in user's id (1 is admin). */
    int userId();

    String userName();

    void log(String message, Throwable error);

    void showError(String message);
}
