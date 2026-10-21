package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.modules.biscripteditor.panel.BiAccessRightsPanel;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fbi.fbdata.bi.BiReportAccessFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.sdk.constants.bi.BiScriptTypeConst;

import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JCheckBox;
import javax.swing.JComboBox;
import javax.swing.JComponent;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JTextField;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Dimension;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.GridLayout;
import java.awt.Insets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Publishes a Report Builder report. The builder page puts its spec in the user's
 * own settings (the outbox) and asks for openModule('Apps (beta)', 'build:publish:<nonce>');
 * this reads the outbox back (only the user can write their own row), checks the
 * nonce, asks for the name, folder, Apps menus and access, writes the page
 * (BuilderPage: the spec, never code) and saves it. The new page's fb-builder tag
 * carries the nonce, which is how the builder learns which record it became.
 *
 * Who may publish:
 *   admin or BI Editor-Edit       any groups, folder and Apps menus (as the code editor)
 *   Apps (beta)-Build Reports     a new report for their own groups only, in the default
 *                                 folder, in no Apps menu; republishing a builder report
 *                                 they have AccessPolicy.EDIT_LEVEL on keeps its access, folder and menus
 * A system page or a page the builder didn't write is never overwritten.
 */
final class BuilderPublisher {

    static final String OUTBOX = "cdx.bi.reportBuilder.outbox.v1";
    static final String DEFAULT_FOLDER = "Custom";
    private static final String TITLE = "Publish app";
    private static final ObjectMapper JSON = new ObjectMapper();

    private BuilderPublisher() {
    }

    static void publish(EditorFeature feature, String nonce) {
        WorkspaceHost host = feature.host();
        ScriptService service = feature.service();
        Component parent = host.plugin();
        int userId = host.userId();

        // ---- the request
        String raw = service.userSetting(userId, OUTBOX);
        JsonNode req;
        try {
            req = raw == null ? null : JSON.readTree(raw);
        } catch (java.io.IOException e) {
            req = null;
        }
        if (req == null || nonce == null || !nonce.equals(req.path("nonce").asText())) {
            host.showError("The app to publish wasn't found. Try Publish again.");
            return;
        }
        JsonNode spec = req.path("spec");
        String problem = BuilderPage.problem(spec, raw.length());
        if (!problem.isEmpty()) {
            host.showError(problem);
            return;
        }

        // ---- who may do what
        boolean wide = ClientRights.mayEdit(host);
        boolean build = wide || service.groupsHaveRight(userId, WorkspaceHost.BUILD_RIGHT);
        if (!build) {
            host.showError("Publishing an app needs the " + WorkspaceHost.BUILD_RIGHT + " or BI Editor-Edit right.");
            return;
        }

        try {
            // ---- the record it updates, if any
            BiScriptFpo target = null;
            int sourceId = req.path("source").path("scriptId").asInt(0);
            if (sourceId > 0) {
                target = service.getScript(sourceId);
                String why = refusal(target, wide, service, host);
                if (!why.isEmpty()) {
                    if (JOptionPane.showConfirmDialog(parent, "<html><body style='width:380px'>" + Completions.esc(why)
                        + "<br><br>Publish it as a new app instead?</body></html>", TITLE, JOptionPane.YES_NO_OPTION) != JOptionPane.YES_OPTION) {
                        return;
                    }
                    target = null;
                }
            }

            // ---- the dialog
            Choice choice = ask(feature, target, spec, wide, userId);
            if (choice == null) {
                return;
            }
            // A report already called that: replace it when the builder made it and the user may.
            int sameName = service.pageIdByName(choice.name);
            if (sameName > 0 && (target == null || sameName != target.getId())) {
                BiScriptFpo other = service.getScript(sameName);
                String why = refusal(other, wide, service, host);
                if (!why.isEmpty()) {
                    host.showError("Another app is already called \"" + choice.name + "\". " + why + " Choose another name.");
                    return;
                }
                if (JOptionPane.showConfirmDialog(parent, "An app called \"" + choice.name + "\" already exists. Replace it with this one?",
                    TITLE, JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE) != JOptionPane.YES_OPTION) {
                    return;
                }
                target = other;
            }

            // ---- the page
            BuilderPage.Def d = new BuilderPage.Def();
            d.name = choice.name;
            d.description = choice.description;
            d.folder = choice.folder;
            d.launch = choice.launch;
            d.spec = spec;
            d.publishNonce = nonce;
            String oldKey = target != null ? BuilderPage.storageKey(target.getData()) : null;
            d.key = oldKey != null ? oldKey : uniqueKey(service, choice.name, target == null ? -1 : target.getId());
            String page = BuilderPage.render(d);

            // ---- save
            BiScriptFpo saved;
            if (target == null) {
                BiScriptFpo fpo = new BiScriptFpo();   // id -1: new
                fpo.setType(BiScriptTypeConst.PAGE);
                fpo.setName(choice.name);
                fpo.setDescription(choice.description);
                fpo.setActive(true);
                fpo.setPublished(true);
                fpo.setNote("");
                fpo.setData(page);
                saved = service.save(fpo, choice.access);
            } else {
                BiScriptFpo fresh = service.getScript(target.getId());
                fresh.setName(choice.name);
                fresh.setDescription(choice.description);
                fresh.setData(page);
                fresh.setActive(true);
                if (!fresh.isPublished()) {
                    fresh.setPublished(true);
                    saved = service.save(fresh, choice.access);
                } else {
                    saved = service.save(fresh, null);   // its access stays as it is
                }
            }

            // ---- afterwards
            List<AccessPolicy.Report> reports = service.reportsFor(saved.getId());
            host.invalidateCatalog();
            feature.reloadCatalog();
            List<Integer> ids = new ArrayList<>();
            reports.forEach(r -> ids.add(r.id));
            if (!ids.isEmpty()) {
                host.reloadReports(ids);
            }
            if (!reports.isEmpty() && JOptionPane.showConfirmDialog(parent, "Published \"" + choice.name + "\". Open it?", TITLE,
                JOptionPane.YES_NO_OPTION, JOptionPane.INFORMATION_MESSAGE) == JOptionPane.YES_OPTION) {
                host.openReport(reports.get(0).id, true);
            }
        } catch (ScriptService.ServiceException | java.io.IOException e) {
            host.showError("Publishing failed: " + e.getMessage());
        }
    }

    /** "" when this user may republish over the page, else why not. */
    static String refusal(BiScriptFpo page, boolean wide, ScriptService service, WorkspaceHost host) {
        if (page == null || page.getTypeId() != 10) {
            return "That record isn't an app.";
        }
        String data = page.getData() == null ? "" : page.getData();
        if (AppGroups.isSystem(data)) {
            return "\"" + page.getName() + "\" is a Fishbowl system app, so it can't be replaced.";
        }
        if (!BuilderPage.isBuilderPage(data)) {
            return "\"" + page.getName() + "\" wasn't made with the App Builder (or was changed in the code editor), so publishing would overwrite its code.";
        }
        List<AccessPolicy.Report> reports = service.reportsFor(page.getId());
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        if (wide) {
            AccessPolicy.Decision d = AccessPolicy.decide(AccessPolicy.Target.PAGE, reports, rights);
            return d.canEdit ? "" : d.reason;
        }
        for (AccessPolicy.Report r : reports) {
            if (!rights.admin && rights.level.apply(r.id) != AccessPolicy.EDIT_LEVEL) {
                return "Replacing \"" + r.name + "\" needs " + AccessPolicy.EDIT_LEVEL.getName() + " on it.";
            }
        }
        return "";
    }

    /** cdx.bi.<name>, unique among pages, 31 characters at most. */
    static String uniqueKey(ScriptService service, String name, int exceptId) {
        String base = TemplateRewriter.storageKey(name);
        String key = base;
        for (int n = 2; service.storageKeyTaken(key, exceptId) && n < 100; n++) {
            String suffix = String.valueOf(n);
            key = (base.length() + suffix.length() > 31 ? base.substring(0, 31 - suffix.length()) : base) + suffix;
        }
        return key;
    }

    // ---------------------------------------------------------------- the dialog
    static final class Choice {
        String name;
        String description;
        String folder;
        String launch;
        /** Access rows for a page published for the first time; null keeps what it has. */
        List<BiReportAccessFpo> access;
    }

    @SuppressWarnings("unchecked")
    private static Choice ask(EditorFeature feature, BiScriptFpo target, JsonNode spec, boolean wide, int userId) {
        WorkspaceHost host = feature.host();
        ScriptService service = feature.service();
        Component parent = host.plugin();
        String data = target != null && target.getData() != null ? target.getData() : "";
        boolean firstPublish = target == null || !target.isPublished();

        JTextField name = new JTextField(target != null ? target.getName() : spec.path("title").asText(""));
        JTextField description = new JTextField(target != null && target.getDescription() != null && !target.getDescription().trim().isEmpty()
            ? target.getDescription() : spec.path("description").asText(""));
        String curFolder = target != null ? AppGroups.folderContent(data) : DEFAULT_FOLDER;
        JComboBox<String> folder = new JComboBox<>();
        for (String f : feature.folderNames()) {
            folder.addItem(f);
        }
        if (curFolder.isEmpty() || feature.folderNames().stream().noneMatch(f -> f.equalsIgnoreCase(curFolder))) {
            folder.addItem(curFolder.isEmpty() ? DEFAULT_FOLDER : curFolder);
        }
        folder.setSelectedItem(curFolder.isEmpty() ? DEFAULT_FOLDER : curFolder);
        folder.setEditable(wide);
        folder.setEnabled(wide);
        String[] launch = { target != null ? AppGroups.launchContent(data) : "" };
        JTextField launchText = new JTextField(launch[0].isEmpty() ? "none" : AppGroups.describe(launch[0]));
        launchText.setEditable(false);
        JButton pick = new JButton("Choose…");
        pick.setEnabled(wide);
        pick.addActionListener(e -> {
            String c = ModulePicker.ask(parent, "Apps menus", launch[0]);
            if (c != null) {
                launch[0] = c;
                launchText.setText(c.isEmpty() ? "none" : AppGroups.describe(c));
            }
        });
        JPanel launchRow = new JPanel(new BorderLayout(4, 0));
        launchRow.add(launchText, BorderLayout.CENTER);
        launchRow.add(pick, BorderLayout.EAST);

        JPanel form = new JPanel(new GridBagLayout());
        GridBagConstraints c = new GridBagConstraints();
        c.insets = new Insets(3, 3, 3, 3);
        String[] labels = {"Name", "Description", "Folder", "Apps menus"};
        JComponent[] fields = {name, description, folder, launchRow};
        for (int i = 0; i < labels.length; i++) {
            c.gridy = i;
            c.gridx = 0;
            c.weightx = 0;
            c.fill = GridBagConstraints.NONE;
            c.anchor = GridBagConstraints.WEST;
            form.add(new JLabel(labels[i]), c);
            c.gridx = 1;
            c.weightx = 1;
            c.fill = GridBagConstraints.HORIZONTAL;
            form.add(fields[i], c);
        }
        form.setPreferredSize(new Dimension(520, form.getPreferredSize().height));
        JPanel content = new JPanel(new BorderLayout(0, 8));
        content.add(form, BorderLayout.NORTH);

        // Who can open it: the native panel for wide publishers, the user's own groups for the rest.
        BiAccessRightsPanel panel = null;
        Map<Integer, JCheckBox> own = new LinkedHashMap<>();
        if (firstPublish) {
            JPanel acc = new JPanel(new BorderLayout());
            acc.setBorder(BorderFactory.createTitledBorder("Who can open it"));
            if (wide) {
                panel = new BiAccessRightsPanel();
                try {
                    panel.init();
                } catch (RuntimeException ignored) {
                    // an empty list: admin only
                }
                panel.setPreferredSize(new Dimension(520, 220));
                acc.add(panel, BorderLayout.CENTER);
            } else {
                JPanel boxes = new JPanel(new GridLayout(0, 2, 6, 2));
                service.myGroups(userId).forEach((id, n) -> {
                    JCheckBox cb = new JCheckBox(n, true);
                    own.put(id, cb);
                    boxes.add(cb);
                });
                acc.add(new JLabel("<html>Your groups can open it and change its settings. Ask an administrator to share it more widely, "
                    + "or to list it in an Apps menu.</html>"), BorderLayout.NORTH);
                acc.add(boxes, BorderLayout.CENTER);
            }
            content.add(acc, BorderLayout.CENTER);
        } else {
            content.add(new JLabel("Who can open it stays as it is (change it with Access… in the App editor)."), BorderLayout.CENTER);
        }

        while (true) {
            if (JOptionPane.showConfirmDialog(parent, content, target == null ? TITLE : "Publish changes to \"" + target.getName() + "\"",
                JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE) != JOptionPane.OK_OPTION) {
                return null;
            }
            String nm = name.getText().trim(), ds = description.getText().trim();
            String fo = folder.getSelectedItem() == null ? DEFAULT_FOLDER : String.valueOf(folder.getSelectedItem()).trim();
            String why = AccessPolicy.validateName(nm, ds);
            if (why.isEmpty() && !fo.isEmpty() && !AppGroups.folderProblem(fo).isEmpty()) {
                why = AppGroups.folderProblem(fo);
            }
            if (why.isEmpty() && firstPublish && !wide && own.values().stream().noneMatch(JCheckBox::isSelected)) {
                why = "Choose at least one of your groups, or nobody but an administrator could open it.";
            }
            if (!why.isEmpty()) {
                JOptionPane.showMessageDialog(parent, why, TITLE, JOptionPane.WARNING_MESSAGE);
                continue;
            }
            Choice ch = new Choice();
            ch.name = nm;
            ch.description = ds;
            ch.folder = wide ? fo : (target != null ? curFolder : DEFAULT_FOLDER);
            ch.launch = wide ? launch[0].toUpperCase() : (target != null ? launch[0] : "");
            if (firstPublish) {
                if (panel != null) {
                    List<BiReportAccessFpo> list = panel.getAccessList();
                    ch.access = list == null ? new ArrayList<>() : list;
                } else {
                    ch.access = new ArrayList<>();
                    for (Map.Entry<Integer, JCheckBox> e : own.entrySet()) {
                        if (e.getValue().isSelected()) {
                            BiReportAccessFpo row = new BiReportAccessFpo();
                            row.setUserGroupId(e.getKey());
                            row.setAccessLevel(AccessPolicy.EDIT_LEVEL);
                            ch.access.add(row);
                        }
                    }
                }
            }
            return ch;
        }
    }
}
