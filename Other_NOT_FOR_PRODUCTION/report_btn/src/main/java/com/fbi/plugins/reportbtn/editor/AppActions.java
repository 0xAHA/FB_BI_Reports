package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.modules.biscripteditor.panel.BiAccessRightsPanel;
import com.fbi.fbdata.bi.BiReportAccessFpo;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.plugins.reportbtn.WorkspaceHost;
import com.fbi.sdk.constants.bi.AccessLevelConst;
import com.fbi.sdk.constants.bi.BiScriptTypeConst;

import javax.swing.BorderFactory;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import java.awt.BorderLayout;
import java.awt.Component;
import java.awt.Cursor;
import java.awt.Dimension;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * What the explorer does to the records it has selected: publish, activate, the
 * dashboard gadget, access, duplicate, download and delete. Each action checks the
 * same rights the editor tab checks, record by record, says up front what it will
 * do and skip, and leaves alone any record with unsaved changes in an editor tab.
 */
final class AppActions {

    /** One record left out, and why. */
    private static final class Skip {
        final String name;
        final String why;

        Skip(String name, String why) {
            this.name = name;
            this.why = why;
        }
    }

    private final EditorFeature feature;
    private final WorkspaceHost host;
    private final ScriptService service;

    AppActions(EditorFeature feature) {
        this.feature = feature;
        this.host = feature.host();
        this.service = feature.service();
    }

    // ---------------------------------------------------------------- flags
    void setActive(Component parent, List<ScriptService.Entry> list, boolean on) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        List<Skip> skip = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.active == on) {
                continue;
            }
            String why = refusal(e, rights);
            if (why.isEmpty()) {
                go.add(e);
            } else {
                skip.add(new Skip(e.name, why));
            }
        }
        String verb = on ? "Activate" : "Deactivate";
        if (!confirm(parent, verb, go, skip, on ? "" : "Inactive scripts and styles stop being included; inactive apps "
            + "stop opening.")) {
            return;
        }
        run(parent, verb.toLowerCase() + "d", go, skip, e -> {
            BiScriptFpo f = service.getScript(e.id);
            f.setActive(on);
            service.save(f, null);
        });
    }

    void setPublished(Component parent, List<ScriptService.Entry> list, boolean on) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        List<Skip> skip = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.typeId != 10 || e.published == on) {
                continue;
            }
            AccessPolicy.Decision d = AccessPolicy.decide(AccessPolicy.Target.PAGE, e.reports, rights);
            String why = !d.canEdit ? d.reason : !on && !d.canUnpublish ? "Unpublishing needs the BI Report-Delete right." : busyTab(e);
            if (why.isEmpty()) {
                go.add(e);
            } else {
                skip.add(new Skip(e.name, why));
            }
        }
        if (go.isEmpty() && skip.isEmpty()) {
            info(parent, on ? "The selected apps are already published." : "None of the selected apps is published.");
            return;
        }
        List<BiReportAccessFpo> access = null;
        if (on && !go.isEmpty()) {
            access = askAccess(parent, "Who can open " + (go.size() == 1 ? go.get(0).name : "the " + go.size() + " apps") + "?", null);
            if (access == null) {
                return;
            }
        }
        if (!confirm(parent, on ? "Publish" : "Unpublish", go, skip, on ? ""
            : "Unpublishing deletes each app's listing, with its saved settings and access.")) {
            return;
        }
        List<BiReportAccessFpo> rows = access;
        run(parent, on ? "published" : "unpublished", go, skip, e -> {
            BiScriptFpo f = service.getScript(e.id);
            f.setPublished(on);
            service.save(f, on ? rows : null);
        });
    }

    void setGadget(Component parent, List<ScriptService.Entry> list, boolean on) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        List<Skip> skip = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.typeId != 10 || (e.published && e.gadget() == on)) {
                continue;
            }
            AccessPolicy.Decision d = AccessPolicy.decide(AccessPolicy.Target.PAGE, e.reports, rights);
            String why = !e.published || e.reports.isEmpty() ? "Not published." : !d.canEditGadget ? d.gadgetReason : busyTab(e);
            if (why.isEmpty()) {
                go.add(e);
            } else {
                skip.add(new Skip(e.name, why));
            }
        }
        if (!confirm(parent, on ? "Make a dashboard gadget" : "Stop being a dashboard gadget", go, skip, "")) {
            return;
        }
        run(parent, on ? "made dashboard gadgets" : "no longer dashboard gadgets", go, skip, e -> {
            for (AccessPolicy.Report r : e.reports) {
                if (r.widget != on) {
                    ScriptService.ReportBundle b = service.loadReport(r.id);
                    b.report.setWidget(on);
                    service.saveReport(b.report, b.access);
                }
            }
        });
    }

    // ---------------------------------------------------------------- access
    void access(Component parent, List<ScriptService.Entry> list) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        List<Skip> skip = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.typeId != 10) {
                continue;
            }
            AccessPolicy.Decision d = AccessPolicy.decide(AccessPolicy.Target.PAGE, e.reports, rights);
            String why = e.reports.isEmpty() ? "Not published." : !d.canEditAccess ? d.accessReason : "";
            if (why.isEmpty()) {
                go.add(e);
            } else {
                skip.add(new Skip(e.name, why));
            }
        }
        if (go.isEmpty()) {
            confirm(parent, "Change access", go, skip, "");
            return;
        }
        List<BiReportAccessFpo> current;
        try {
            current = service.loadReport(go.get(0).reports.get(0).id).access;
        } catch (ScriptService.ServiceException ex) {
            error(parent, ex.getMessage());
            return;
        }
        String title = go.size() == 1 ? "Who can open " + go.get(0).name + "?"
            : "Access for " + go.size() + " apps (starting from " + go.get(0).name + "'s)";
        List<BiReportAccessFpo> chosen = askAccess(parent, title, current);
        if (chosen == null) {
            return;
        }
        if (!keepsMyEditSettings(chosen) && JOptionPane.showConfirmDialog(parent, "None of your groups would keep Edit Settings, "
            + "so you couldn't edit these apps afterwards. Save anyway?", "App access", JOptionPane.YES_NO_OPTION,
            JOptionPane.WARNING_MESSAGE) != JOptionPane.YES_OPTION) {
            return;
        }
        if (go.size() > 1 && !confirm(parent, "Replace the access of", go, skip,
            "Each app gets exactly these groups and levels; groups not listed lose access.")) {
            return;
        }
        run(parent, "given the new access", go, skip, e -> {
            for (AccessPolicy.Report r : e.reports) {
                ScriptService.ReportBundle b = service.loadReport(r.id);
                service.saveReport(b.report, merged(b.access, chosen, r.id));
            }
        });
    }

    /**
     * The chosen levels laid over a report's own rows: its existing row for a group is
     * updated (so its id stays), a new group gets a new row, and a group that isn't
     * chosen any more is set to None, which the server deletes. Rows are never moved
     * from one report to another.
     */
    static List<BiReportAccessFpo> merged(List<BiReportAccessFpo> current, List<BiReportAccessFpo> chosen, int reportId) {
        Map<Integer, AccessLevelConst> want = new LinkedHashMap<>();
        Map<Integer, BiReportAccessFpo> template = new HashMap<>();
        for (BiReportAccessFpo c : chosen) {
            want.put(c.getUserGroupId(), c.getAccessLevel() == null ? AccessLevelConst.NONE : c.getAccessLevel());
            template.put(c.getUserGroupId(), c);
        }
        List<BiReportAccessFpo> out = new ArrayList<>();
        Set<Integer> seen = new java.util.HashSet<>();
        for (BiReportAccessFpo row : current) {
            AccessLevelConst lv = want.getOrDefault(row.getUserGroupId(), AccessLevelConst.NONE);
            row.setAccessLevel(lv);
            out.add(row);
            seen.add(row.getUserGroupId());
        }
        for (Map.Entry<Integer, AccessLevelConst> w : want.entrySet()) {
            if (seen.contains(w.getKey()) || w.getValue() == AccessLevelConst.NONE) {
                continue;
            }
            BiReportAccessFpo n = new BiReportAccessFpo();
            n.setUserGroupId(w.getKey());
            BiReportAccessFpo t = template.get(w.getKey());
            if (t != null && t.getUserGroup() != null) {
                n.setUserGroup(t.getUserGroup());
            }
            n.setAccessLevel(w.getValue());
            n.setBiReportId(reportId);
            out.add(n);
        }
        return out;
    }

    // ---------------------------------------------------------------- folders and module association
    /**
     * Files apps in a folder (null: Unfiled) by rewriting, or adding, the folder tag
     * in each page and saving it. The module association is untouched. No confirm:
     * one line afterwards says what moved. Built-in pages are left alone: changing
     * their code makes Fishbowl save a copy.
     */
    void moveToFolder(Component parent, List<ScriptService.Entry> list, String folder) {
        String label = folder == null ? AppGroups.UNFILED : folder;
        List<ScriptService.Entry> go = editablePages(list, e -> !(folder == null ? e.folder.isEmpty() : folder.equalsIgnoreCase(e.folder)), false);
        quietly(parent, go, lastSkips, e -> savePage(e, data -> AppGroups.setFolder(data, folder)),
            done -> subject(done) + " moved to " + label + ".");
    }

    /** An app as selected under one Apps-menu node (the key that put it there; null: in no Apps menu). */
    static final class KeyMove {
        final ScriptService.Entry entry;
        final String fromKey;

        KeyMove(ScriptService.Entry entry, String fromKey) {
            this.entry = entry;
            this.fromKey = fromKey;
        }
    }

    /** Takes each app out of the Apps menu it was selected under. */
    void removeFromModule(Component parent, List<KeyMove> moves) {
        Map<Integer, String> keyOf = new HashMap<>();
        List<ScriptService.Entry> list = new ArrayList<>();
        Set<String> keys = new java.util.LinkedHashSet<>();
        for (KeyMove m : moves) {
            if (m.fromKey != null) {
                keyOf.put(m.entry.id, m.fromKey);
                list.add(m.entry);
                keys.add(m.fromKey.toUpperCase(java.util.Locale.ROOT));
            }
        }
        String where = keys.size() == 1 ? AppGroups.keyLabel(keys.iterator().next()) : "their Apps menus";
        List<ScriptService.Entry> go = editablePages(list, e -> true, true);
        quietly(parent, go, lastSkips, e -> saveMenus(e, now -> AppGroups.retag(now, keyOf.get(e.id), null)),
            done -> subject(done) + " removed from " + where + ".");
    }

    /** Adds the apps to one Apps menu (a module key, or a menu-group key for every module in it). */
    void addToModule(Component parent, List<ScriptService.Entry> list, String key) {
        List<ScriptService.Entry> go = editablePages(list,
            e -> AppGroups.keys(e.launchTag).stream().noneMatch(k -> k.equalsIgnoreCase(key)), true);
        quietly(parent, go, lastSkips, e -> saveMenus(e, now -> AppGroups.retag(now, null, key)),
            done -> subject(done) + " added to " + AppGroups.keyLabel(key) + ".");
    }

    /** A drag in the Apps menus view: from the node each app was under to toKey (copy keeps the old one). */
    void moveModule(Component parent, List<KeyMove> moves, String toKey, boolean copy) {
        Map<Integer, String> keyOf = new HashMap<>();
        List<ScriptService.Entry> list = new ArrayList<>();
        for (KeyMove m : moves) {
            keyOf.put(m.entry.id, copy && toKey != null ? null : m.fromKey);
            list.add(m.entry);
        }
        List<ScriptService.Entry> go = editablePages(list, e -> {
            String next = AppGroups.retag(e.launchTag, keyOf.get(e.id), toKey);
            return !next.equalsIgnoreCase(AppGroups.retag(e.launchTag, null, null));
        }, true);
        quietly(parent, go, lastSkips, e -> saveMenus(e, now -> AppGroups.retag(now, keyOf.get(e.id), toKey)),
            done -> toKey == null ? subject(done) + " taken out of that Apps menu."
                : subject(done) + (copy ? " added to " : " moved to ") + AppGroups.keyLabel(toKey) + ".");
    }

    /** The Apps menus picker for the apps (starting from the first one's), then saves. */
    void setModules(Component parent, List<ScriptService.Entry> list) {
        List<ScriptService.Entry> pages = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.typeId == 10) {
                pages.add(e);
            }
        }
        if (pages.isEmpty()) {
            info(parent, "Only apps appear in Apps menus.");
            return;
        }
        String content = ModulePicker.ask(parent, pages.size() == 1 ? "Apps menus: " + pages.get(0).name
            : "Apps menus for " + pages.size() + " apps", pages.get(0).launchTag);
        if (content == null) {
            return;
        }
        List<ScriptService.Entry> go = editablePages(pages, e -> !AppGroups.retag(e.launchTag, null, null).equalsIgnoreCase(content), true);
        quietly(parent, go, lastSkips, e -> saveMenus(e, now -> content),
            done -> (done.size() == 1 ? "\"" + done.get(0).name + "\" now shows in " : done.size() + " apps now show in ")
                + (content.isEmpty() ? "no Apps menu" : AppGroups.describe(content)) + ".");
    }

    /** "\"Name\" was" or "3 apps were". */
    private static String subject(List<ScriptService.Entry> done) {
        return done.size() == 1 ? "\"" + done.get(0).name + "\" was" : done.size() + " apps were";
    }

    private interface Message {
        String of(List<ScriptService.Entry> done);
    }

    /** Runs op on each record without asking first, then one line on what happened (and why any were left out). */
    private void quietly(Component parent, List<ScriptService.Entry> go, List<Skip> skip, Op op, Message message) {
        List<Skip> failed = new ArrayList<>();
        List<ScriptService.Entry> done = new ArrayList<>();
        Cursor before = parent.getCursor();
        parent.setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
        try {
            for (ScriptService.Entry e : go) {
                try {
                    op.apply(e);
                    done.add(e);
                } catch (ScriptService.ServiceException ex) {
                    failed.add(new Skip(e.name, ex.getMessage()));
                }
            }
        } finally {
            parent.setCursor(before);
            if (!go.isEmpty()) {
                feature.recordsChanged(go);
            }
        }
        if (done.isEmpty() && failed.isEmpty() && skip.isEmpty()) {
            return;   // nothing needed changing
        }
        StringBuilder b = new StringBuilder("<html><body style='width:380px'>");
        if (!done.isEmpty()) {
            b.append(Completions.esc(message.of(done)));
        }
        List<Skip> notDone = new ArrayList<>(failed);
        notDone.addAll(skip);
        if (!notDone.isEmpty()) {
            b.append(done.isEmpty() ? "" : "<br><br>").append("Not changed:").append(list(notDone));
        }
        b.append("</body></html>");
        JOptionPane.showMessageDialog(parent, b.toString(), "Apps", notDone.isEmpty() ? JOptionPane.INFORMATION_MESSAGE
            : JOptionPane.WARNING_MESSAGE);
    }

    /** Asks for a new folder's name and stores it; returns the name, or null. Needs Reports-CompanyEdit. */
    String newFolder(Component parent, List<String> existing) {
        if (!ClientRights.mayManageFolders(host)) {
            error(parent, "Creating folders needs the Reports-Company Edit right.");
            return null;
        }
        String name = JOptionPane.showInputDialog(parent, "Folder name:", "New folder", JOptionPane.PLAIN_MESSAGE);
        if (name == null) {
            return null;
        }
        name = name.trim();
        String problem = AppGroups.folderProblem(name);
        for (String f : existing) {
            if (problem.isEmpty() && f.equalsIgnoreCase(name)) {
                problem = "There is already a folder named \"" + f + "\".";
            }
        }
        if (!problem.isEmpty()) {
            error(parent, problem);
            return null;
        }
        List<String> stored = FolderStore.read(host.plugin());
        stored.add(name);
        try {
            FolderStore.write(host.plugin(), stored);
        } catch (ScriptService.ServiceException e) {
            error(parent, e.getMessage());
            return null;
        }
        feature.reloadCatalog();
        return name;
    }

    /** Renames a folder the panel created (or one only apps use), refiling its apps. Fishbowl's own folders can't be renamed. */
    void renameFolder(Component parent, String folder, List<ScriptService.Entry> inside, List<String> existing, boolean isNative) {
        if (isNative) {
            info(parent, "\"" + folder + "\" is one of Fishbowl's own report folders (Reporting › Reports); it can't be renamed here.");
            return;
        }
        if (!ClientRights.mayManageFolders(host)) {
            error(parent, "Renaming folders needs the Reports-Company Edit right.");
            return;
        }
        String name = (String) JOptionPane.showInputDialog(parent, "New name for \"" + folder + "\":", "Rename folder",
            JOptionPane.PLAIN_MESSAGE, null, null, folder);
        if (name == null || name.trim().equals(folder)) {
            return;
        }
        String to = name.trim();
        String problem = AppGroups.folderProblem(to);
        for (String f : existing) {
            if (problem.isEmpty() && f.equalsIgnoreCase(to) && !f.equalsIgnoreCase(folder)) {
                problem = "There is already a folder named \"" + f + "\".";
            }
        }
        if (!problem.isEmpty()) {
            error(parent, problem);
            return;
        }
        List<String> stored = FolderStore.read(host.plugin());
        stored.removeIf(f -> f.equalsIgnoreCase(folder));
        stored.add(to);
        try {
            FolderStore.write(host.plugin(), stored);
        } catch (ScriptService.ServiceException e) {
            error(parent, e.getMessage());
            return;
        }
        if (inside.isEmpty()) {
            feature.reloadCatalog();
            return;
        }
        moveToFolder(parent, inside, to);
    }

    /** Deletes a folder the panel created, once no app is in it. */
    void deleteFolder(Component parent, String folder, int apps, boolean isNative) {
        if (isNative) {
            info(parent, "\"" + folder + "\" is one of Fishbowl's own report folders (Reporting › Reports); it can't be deleted here.");
            return;
        }
        if (!ClientRights.mayManageFolders(host)) {
            error(parent, "Deleting folders needs the Reports-Company Edit right.");
            return;
        }
        if (apps > 0) {
            info(parent, "\"" + folder + "\" still holds " + apps + " app" + (apps == 1 ? "" : "s") + ": move "
                + (apps == 1 ? "it" : "them") + " to another folder first.");
            return;
        }
        if (JOptionPane.showConfirmDialog(parent, "Delete the empty folder \"" + folder + "\"?", "Delete folder",
            JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) {
            return;
        }
        List<String> stored = FolderStore.read(host.plugin());
        stored.removeIf(f -> f.equalsIgnoreCase(folder));
        try {
            FolderStore.write(host.plugin(), stored);
        } catch (ScriptService.ServiceException e) {
            error(parent, e.getMessage());
            return;
        }
        feature.reloadCatalog();
    }

    /**
     * The pages in list that need the change and may be changed; the rest land in lastSkips.
     * menus: an Apps-menus change, which a system app takes too (MenuOverrides keeps it;
     * its code stays as shipped); its folder stays fixed.
     */
    private List<ScriptService.Entry> editablePages(List<ScriptService.Entry> list, java.util.function.Predicate<ScriptService.Entry> needs,
                                                    boolean menus) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        lastSkips = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            if (e.typeId != 10 || !needs.test(e)) {
                continue;
            }
            String why = e.system && !menus ? "It's a Fishbowl system app, so its folder is fixed (its Apps menus can be changed)."
                : e.system ? refusal(e, rights)
                : e.builtIn ? "It's one of Fishbowl's own apps: change it in the editor, which keeps the original."
                : refusal(e, rights);
            if (why.isEmpty()) {
                go.add(e);
            } else {
                lastSkips.add(new Skip(e.name, why));
            }
        }
        return go;
    }

    private List<Skip> lastSkips = new ArrayList<>();

    private interface Rewrite {
        String apply(String data);
    }

    private interface MenuChange {
        String apply(String current);
    }

    /**
     * Sets an app's Apps menus from its current ones: a system app's in MenuOverrides
     * (its code is locked), any other app's fb-launch tag in its code.
     */
    private void saveMenus(ScriptService.Entry e, MenuChange change) throws ScriptService.ServiceException {
        if (e.system) {
            try {
                com.fbi.plugins.reportbtn.MenuOverrides.save(e.name, change.apply(e.launchTag));
            } catch (Exception ex) {
                throw new ScriptService.ServiceException(ex.getMessage());
            }
            return;
        }
        savePage(e, data -> AppGroups.rewrite(data, change.apply(AppGroups.launchContent(data))));
    }

    /** Reads the page fresh, rewrites its code and saves it. */
    private void savePage(ScriptService.Entry e, Rewrite rewrite) throws ScriptService.ServiceException {
        BiScriptFpo f = service.getScript(e.id);
        String data = f.getData() == null ? "" : f.getData();
        String updated = rewrite.apply(data);
        if (updated == null || updated.equals(data)) {
            return;   // already so (a missing tag is always added, head or not)
        }
        f.setData(updated);
        service.save(f, null);
    }

    // ---------------------------------------------------------------- copies, files, delete
    /**
     * Copies records as new, unpublished, custom records. One record asks for the
     * copy's name and opens it; several are named "<name> Copy". An app's copy gets
     * its own identity (name, storage key) and a custom origin, so a system app's copy
     * can be edited.
     */
    void duplicate(Component parent, List<ScriptService.Entry> list) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        if (!rights.admin && !rights.biEditorEdit) {
            error(parent, "Duplicating needs the BI Editor-Edit right.");
            return;
        }
        if (list.size() == 1) {
            ScriptService.Entry e = list.get(0);
            String name = askCopyName(parent, e);
            if (name == null) {
                return;
            }
            try {
                BiScriptFpo copy = copy(e, name);
                feature.reloadCatalog();
                feature.openById(copy.getId());
            } catch (ScriptService.ServiceException ex) {
                error(parent, ex.getMessage());
            }
            return;
        }
        if (!confirm(parent, "Duplicate", list, new ArrayList<>(), "Each copy is named \"<name> Copy\", starts unpublished "
            + "and is a custom app you can edit.")) {
            return;
        }
        run(parent, "duplicated", list, new ArrayList<>(), e -> copy(e, copyName(e.name, e.typeId)));
    }

    /** A new record with the original's code and description, under name; an app's identity follows the name. */
    private BiScriptFpo copy(ScriptService.Entry e, String name) throws ScriptService.ServiceException {
        BiScriptFpo from = service.getScript(e.id);
        String data = from.getData() == null ? "" : from.getData();
        BiScriptFpo c = new BiScriptFpo();   // id -1: new
        c.setType(BiScriptTypeConst.getConst(e.typeId));
        c.setName(name);
        c.setDescription(from.getDescription() == null || from.getDescription().trim().isEmpty() ? name : from.getDescription());
        c.setActive(true);
        c.setPublished(false);
        c.setNote(from.getNote() == null ? "" : from.getNote());
        c.setData(e.typeId == 10 ? TemplateRewriter.copyOf(data, name) : data);
        return service.save(c, null);
    }

    /** "<name> Copy" (then "Copy 2", …): free, at most 64 characters. */
    private String copyName(String name, int typeId) {
        for (int n = 1; ; n++) {
            String suffix = n == 1 ? " Copy" : " Copy " + n;
            String base = name.length() + suffix.length() > 64 ? name.substring(0, 64 - suffix.length()).trim() : name;
            if (!service.nameTaken(base + suffix, typeId, -1)) {
                return base + suffix;
            }
        }
    }

    /** The copy's name, checked as a save would; null when cancelled. */
    private String askCopyName(Component parent, ScriptService.Entry e) {
        String name = copyName(e.name, e.typeId);
        while (true) {
            Object v = JOptionPane.showInputDialog(parent, "Name of the copy of " + e.name + ":", "Duplicate",
                JOptionPane.PLAIN_MESSAGE, null, null, name);
            if (v == null) {
                return null;
            }
            name = String.valueOf(v).trim();
            String problem = AccessPolicy.validateName(name, "-");
            if (problem.isEmpty() && service.nameTaken(name, e.typeId, -1)) {
                problem = "Another " + e.kind().toLowerCase() + " is already named \"" + name + "\".";
            }
            if (problem.isEmpty()) {
                return name;
            }
            error(parent, problem);
        }
    }

    void download(Component parent, List<ScriptService.Entry> list) {
        if (!ClientRights.mayView(host)) {
            error(parent, "Downloading needs the BI Editor-View right.");
            return;
        }
        Map<Integer, BiScriptFpo> records = new LinkedHashMap<>();
        List<String> unsaved = new ArrayList<>();
        Cursor before = parent.getCursor();
        parent.setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
        try {
            for (ScriptService.Entry e : list) {
                EditorTab t = feature.tabFor(e.id);
                if (t != null && t.isDirty()) {
                    unsaved.add(e.name);
                }
                for (BiScriptFpo r : service.exportData(e.id)) {
                    records.putIfAbsent(r.getId(), r);
                }
            }
        } catch (ScriptService.ServiceException ex) {
            error(parent, ex.getMessage());
            return;
        } finally {
            parent.setCursor(before);
        }
        if (!unsaved.isEmpty() && JOptionPane.showConfirmDialog(parent, "<html><body style='width:380px'>"
            + Completions.esc(String.join(", ", unsaved)) + " " + (unsaved.size() == 1 ? "has" : "have")
            + " unsaved changes; the saved version is downloaded. Continue?</body></html>", "Download",
            JOptionPane.OK_CANCEL_OPTION) != JOptionPane.OK_OPTION) {
            return;
        }
        Exporter.write(parent, records.values());
    }

    void delete(Component parent, List<ScriptService.Entry> list) {
        AccessPolicy.Rights rights = ClientRights.current(host, service);
        List<ScriptService.Entry> go = new ArrayList<>();
        List<ScriptService.Entry> builtIns = new ArrayList<>();
        List<Skip> skip = new ArrayList<>();
        List<String> used = new ArrayList<>();
        for (ScriptService.Entry e : list) {
            String why = AccessPolicy.deleteRefusal(AccessPolicy.target(e.typeId), e.reports, rights);
            if (why.isEmpty()) {
                why = busyTab(e);
            }
            if (!why.isEmpty()) {
                skip.add(new Skip(e.name, why));
            } else if (e.builtIn || e.system) {
                builtIns.add(e);
            } else {
                go.add(e);
                if (e.typeId != 10) {
                    int n = service.pagesUsing(e.kind(), e.name);
                    if (n > 0) {
                        used.add(e.name + " (included by " + n + " app" + (n == 1 ? "" : "s") + ")");
                    }
                }
            }
        }
        if (!builtIns.isEmpty()) {
            int a = JOptionPane.showConfirmDialog(parent, "<html><body style='width:380px'>" + builtIns.size() + " record"
                + (builtIns.size() == 1 ? " ships" : "s ship") + " with Fishbowl and can't be deleted: "
                + Completions.esc(names(builtIns)) + ".<br><br>Deactivate " + (builtIns.size() == 1 ? "it" : "them")
                + " instead?</body></html>", "Delete", JOptionPane.YES_NO_CANCEL_OPTION, JOptionPane.QUESTION_MESSAGE);
            if (a == JOptionPane.CANCEL_OPTION || a == JOptionPane.CLOSED_OPTION) {
                return;
            }
            if (a == JOptionPane.YES_OPTION) {
                setActive(parent, builtIns, false);
            }
        }
        if (go.isEmpty() && skip.isEmpty()) {
            return;
        }
        String warn = "This can't be undone. Deleting an app also deletes its listing, saved settings and access."
            + (used.isEmpty() ? "" : " Still included: " + String.join(", ", used) + "; those apps will fail to load it.");
        if (!confirm(parent, "Delete", go, skip, warn)) {
            return;
        }
        for (ScriptService.Entry e : go) {
            EditorTab t = feature.tabFor(e.id);
            if (t != null) {
                host.closeTab(t);
            }
        }
        run(parent, "deleted", go, skip, e -> service.delete(e.id));
    }

    // ---------------------------------------------------------------- helpers
    private interface Op {
        void apply(ScriptService.Entry e) throws ScriptService.ServiceException;
    }

    /** Runs op on each record, then reports what happened and refreshes everything that shows them. */
    private void run(Component parent, String pastTense, List<ScriptService.Entry> go, List<Skip> skip, Op op) {
        if (go.isEmpty()) {
            return;
        }
        List<Skip> failed = new ArrayList<>();
        int done = 0;
        Cursor before = parent.getCursor();
        parent.setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
        try {
            for (ScriptService.Entry e : go) {
                try {
                    op.apply(e);
                    done++;
                } catch (ScriptService.ServiceException ex) {
                    failed.add(new Skip(e.name, ex.getMessage()));
                }
            }
        } finally {
            parent.setCursor(before);
            feature.recordsChanged(go);
        }
        StringBuilder b = new StringBuilder("<html><body style='width:420px'>");
        b.append(done).append(done == 1 ? " record " : " records ").append(Completions.esc(pastTense)).append('.');
        if (!failed.isEmpty()) {
            b.append("<br><br><b>Failed:</b>").append(list(failed));
        }
        if (!skip.isEmpty()) {
            b.append("<br><br><b>Skipped:</b>").append(list(skip));
        }
        b.append("</body></html>");
        JOptionPane.showMessageDialog(parent, b.toString(), "Apps", failed.isEmpty() ? JOptionPane.INFORMATION_MESSAGE
            : JOptionPane.WARNING_MESSAGE);
    }

    /** One confirm: what will happen to whom, what is skipped and why. False cancels. */
    private boolean confirm(Component parent, String verb, List<ScriptService.Entry> go, List<Skip> skip, String note) {
        if (go.isEmpty()) {
            if (!skip.isEmpty()) {
                JOptionPane.showMessageDialog(parent, "<html><body style='width:420px'>Nothing to do. Skipped:" + list(skip)
                    + "</body></html>", "Apps", JOptionPane.INFORMATION_MESSAGE);
            }
            return false;
        }
        StringBuilder b = new StringBuilder("<html><body style='width:420px'><b>").append(Completions.esc(verb)).append(' ')
            .append(go.size() == 1 ? Completions.esc(go.get(0).name) : go.size() + " records").append("?</b>");
        if (go.size() > 1) {
            b.append("<br>").append(Completions.esc(names(go)));
        }
        if (!note.isEmpty()) {
            b.append("<br><br>").append(Completions.esc(note).replace("\n", "<br>"));
        }
        if (!skip.isEmpty()) {
            b.append("<br><br><b>Skipped:</b>").append(list(skip));
        }
        b.append("</body></html>");
        return JOptionPane.showConfirmDialog(parent, b.toString(), "Apps", JOptionPane.OK_CANCEL_OPTION,
            JOptionPane.QUESTION_MESSAGE) == JOptionPane.OK_OPTION;
    }

    /** Edit rights for the record, then its editor tab: "" when it may be changed. */
    private String refusal(ScriptService.Entry e, AccessPolicy.Rights rights) {
        AccessPolicy.Decision d = AccessPolicy.decide(AccessPolicy.target(e.typeId), e.reports, rights);
        return d.canEdit ? busyTab(e) : d.reason;
    }

    private String busyTab(ScriptService.Entry e) {
        EditorTab t = feature.tabFor(e.id);
        return t != null && t.isDirty() ? "It has unsaved changes in an editor tab: save or close it first." : "";
    }

    /** The native access panel in a dialog; null when cancelled. */
    @SuppressWarnings("unchecked")
    private static List<BiReportAccessFpo> askAccess(Component parent, String title, List<BiReportAccessFpo> start) {
        BiAccessRightsPanel panel = new BiAccessRightsPanel();
        try {
            if (start == null) {
                panel.init();   // the default groups, as the BI Editor's Publish does
            } else {
                panel.init(start);
            }
        } catch (RuntimeException ignored) {
            // an empty list: admin only
        }
        panel.setPreferredSize(new Dimension(520, 320));
        JPanel wrap = new JPanel(new BorderLayout(0, 6));
        wrap.add(new JLabel(title), BorderLayout.NORTH);
        wrap.add(panel, BorderLayout.CENTER);
        wrap.setBorder(BorderFactory.createEmptyBorder(2, 2, 2, 2));
        if (JOptionPane.showConfirmDialog(parent, wrap, "App access", JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE)
            != JOptionPane.OK_OPTION) {
            return null;
        }
        List<BiReportAccessFpo> list = panel.getAccessList();
        return list == null ? new ArrayList<>() : list;
    }

    private boolean keepsMyEditSettings(List<BiReportAccessFpo> list) {
        if (ClientRights.isAdmin(host)) {
            return true;
        }
        Set<Integer> mine = service.myGroupIds(host.userId());
        for (BiReportAccessFpo a : list) {
            if (mine.contains(a.getUserGroupId()) && a.getAccessLevel() == AccessLevelConst.EDIT_SETTINGS) {
                return true;
            }
        }
        return false;
    }

    private static String names(List<ScriptService.Entry> list) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < list.size() && i < 12; i++) {
            b.append(i == 0 ? "" : ", ").append(list.get(i).name);
        }
        if (list.size() > 12) {
            b.append(" and ").append(list.size() - 12).append(" more");
        }
        return b.toString();
    }

    private static String list(List<Skip> skip) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < skip.size() && i < 12; i++) {
            b.append("<br>&bull; ").append(Completions.esc(skip.get(i).name)).append(": ").append(Completions.esc(skip.get(i).why));
        }
        if (skip.size() > 12) {
            b.append("<br>… and ").append(skip.size() - 12).append(" more");
        }
        return b.toString();
    }

    private static void info(Component parent, String text) {
        JOptionPane.showMessageDialog(parent, text, "Apps", JOptionPane.INFORMATION_MESSAGE);
    }

    private static void error(Component parent, String text) {
        JOptionPane.showMessageDialog(parent, "<html><body style='width:380px'>" + Completions.esc(text) + "</body></html>",
            "Apps", JOptionPane.ERROR_MESSAGE);
    }
}
