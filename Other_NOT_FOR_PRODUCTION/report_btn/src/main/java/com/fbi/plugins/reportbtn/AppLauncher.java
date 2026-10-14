package com.fbi.plugins.reportbtn;

import com.evnt.client.Client;
import com.evnt.client.modules.ClientModuleImpl;
import com.evnt.client.modules.bireport.panels.BiBrowserPanel;
import com.fbi.fbdata.QueryParameter;
import com.fbi.fbdata.bi.BiReportFpo;

import javax.swing.JFrame;
import javax.swing.JOptionPane;
import java.awt.BorderLayout;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Opens an app (a BI report) in its own window on the current record.
 *
 * The report is loaded as the BI Reports module loads it (ReportLoader) and shown
 * in BiBrowserPanel, which brings the native Refresh / Parameters / Save / Print /
 * Email toolbar and substitutes the report settings; a real report id lets the
 * report's own data load. Before loading, window.FB_LAUNCH is inserted right
 * after the head tag.
 */
final class AppLauncher {

    private static final Pattern HEAD = Pattern.compile("<head(\\s[^>]*)?>", Pattern.CASE_INSENSITIVE);

    private AppLauncher() {
    }

    static void launch(AppCatalog.App app, ClientModuleImpl module) {
        Client client = ReportAppsMenu.client();
        try {
            if (!module.checkForSave()) {
                return;   // the user cancelled the save prompt
            }
            String moduleName = module.getModuleName();
            ModuleCodes.Entry record = ModuleCodes.of(moduleName);
            int id = module.getObjectId();
            String num = id > 0 ? recordLabel(record, id) : null;

            ReportLoader.Loaded loaded = ReportLoader.load(app.id, app.name, module);
            BiReportFpo report = loaded.report;
            String html = insertScript(loaded.html, "FB_LAUNCH", payload(record, moduleName, id, num, report.getId()));
            open(client, module, report, html, loaded.params, title(report.getName(), moduleName, num));
        } catch (ReportLoader.LoadException e) {
            error(client, e.getMessage());
        } catch (Exception e) {
            ReportAppsPlugin.log("Opening " + app.name + " failed", e);
            error(client, "Could not open \"" + app.name + "\": " + e.getMessage());
        }
    }

    private static void open(Client client, ClientModuleImpl module, BiReportFpo report, String html,
                             Set<QueryParameter> params, String title) {
        JFrame frame = new JFrame(title);
        if (client != null) {
            frame.setIconImages(client.getIconImages());
        }
        BiBrowserPanel panel = new BiBrowserPanel();
        panel.init(module, false);   // as BiReportModuleClient does
        frame.getContentPane().add(panel, BorderLayout.CENTER);
        frame.setDefaultCloseOperation(JFrame.DISPOSE_ON_CLOSE);
        frame.addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosed(WindowEvent e) {
                panel.dispose();
            }
        });
        frame.setSize(1100, 860);
        frame.setLocationRelativeTo(client);
        frame.setVisible(true);
        panel.loadHTML(html, report.getId(), report.getName(), false, params);
        BrowserFit.afterLoad(panel);
    }

    /** The record's number (or name), for the window title and FB_LAUNCH.num. */
    private static String recordLabel(ModuleCodes.Entry record, int id) {
        ReportAppsPlugin plugin = ReportAppsPlugin.current();
        if (record.table == null || record.labelColumn == null || plugin == null) {
            return null;
        }
        try {
            // Table and column are constants from ModuleCodes; id is an int.
            List<?> rows = plugin.runQuery("SELECT " + record.labelColumn + " AS label FROM " + record.table + " WHERE id = " + id);
            return rows == null || rows.isEmpty() ? null : AppCatalog.column(rows.get(0), "label");
        } catch (Exception e) {
            ReportAppsPlugin.log("Reading the record number failed", e);
            return null;
        }
    }

    /** window.FB_LAUNCH, spec in LAUNCH_CONTEXT.md. */
    static String payload(ModuleCodes.Entry record, String moduleName, int id, String num, int reportId) {
        StringBuilder json = new StringBuilder("{\"v\":1,\"host\":\"report_btn\"");
        json.append(",\"module\":").append(jsonString(record.code));
        json.append(",\"moduleName\":").append(jsonString(moduleName == null ? "" : moduleName));
        if (record.table != null) {
            json.append(",\"table\":").append(jsonString(record.table));
        }
        json.append(",\"id\":").append(Math.max(id, 0));
        if (num != null) {
            json.append(",\"num\":").append(jsonString(num));
        }
        json.append(",\"reportId\":").append(reportId);
        json.append(",\"params\":{}}");
        return json.toString();
    }

    /**
     * A JSON string that is also safe inside a script tag in a Fishbowl page:
     * no "<" (cannot close the script) and no "$" (cannot form a setting token,
     * which BiBrowserPanel substitutes by global text replacement).
     */
    static String jsonString(String s) {
        StringBuilder out = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '<': out.append("\\u003c"); break;
                case '$': out.append("\\u0024"); break;
                default:
                    if (c < 0x20 || c == ' ' || c == ' ') {
                        out.append(String.format("\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        return out.append('"').toString();
    }

    /**
     * Inserts window.&lt;name&gt; = &lt;json&gt; right after the first head tag outside a
     * comment (else at the top). The json must come from jsonString-escaped parts.
     */
    static String insertScript(String html, String name, String json) {
        String tag = "<script>window." + name + "=" + json + ";</script>";
        Matcher m = HEAD.matcher(html);
        while (m.find()) {
            if (html.lastIndexOf("<!--", m.start()) <= html.lastIndexOf("-->", m.start())) {
                return html.substring(0, m.end()) + tag + html.substring(m.end());
            }
        }
        return tag + html;
    }

    private static String title(String reportName, String moduleName, String num) {
        return reportName + " — " + moduleName + (num != null && !num.isEmpty() ? " " + num : "");
    }

    private static void error(Client client, String text) {
        JOptionPane.showMessageDialog(client, text, ReportAppsPlugin.MODULE_NAME, JOptionPane.ERROR_MESSAGE);
    }
}
