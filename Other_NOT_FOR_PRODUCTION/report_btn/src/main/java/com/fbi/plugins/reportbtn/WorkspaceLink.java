package com.fbi.plugins.reportbtn;

import java.util.Locale;

/**
 * What a report asks the Apps (beta) module for, through the bridge's
 * openModule('Apps (beta)', item). The client hands item to the module's
 * handleHyperLink, trimmed.
 *
 *   123              open bireport 123 in the selected tab
 *   - Sales - X      open the report with that exact name in the selected tab
 *   tab:123          ... in a new tab (also tab:&lt;name&gt;)
 *   home             open the Home report (tab:home: in a new tab)
 *   back / forward   step through the selected tab's history
 *   edit:123         open report 123's page in the editor (also edit:&lt;name&gt;),
 *                    when the page editor is part of the build
 *
 * Keywords and prefixes ignore case. An empty item only switches to the
 * workspace, so it parses to null, as does anything unusable.
 */
final class WorkspaceLink {

    enum Action { OPEN, HOME, BACK, FORWARD, EDIT }

    private static final String TAB = "tab:";
    private static final String EDIT = "edit:";

    final Action action;
    final boolean newTab;
    /** The report id, or 0 when the report is named. */
    final int id;
    /** The report name, or null when the report is an id. */
    final String name;

    private WorkspaceLink(Action action, boolean newTab, int id, String name) {
        this.action = action;
        this.newTab = newTab;
        this.id = id;
        this.name = name;
    }

    static WorkspaceLink parse(String item) {
        if (item == null) {
            return null;
        }
        String text = item.trim();
        boolean newTab = false;
        if (text.regionMatches(true, 0, TAB, 0, TAB.length())) {
            newTab = true;
            text = text.substring(TAB.length()).trim();
        }
        if (text.isEmpty()) {
            return null;
        }
        // edit: comes before the id / name fallbacks; the editor opens its own tab.
        if (text.regionMatches(true, 0, EDIT, 0, EDIT.length())) {
            String target = text.substring(EDIT.length()).trim();
            if (target.isEmpty()) {
                return null;
            }
            if (target.matches("\\d{1,9}")) {
                int id = Integer.parseInt(target);
                return id > 0 ? new WorkspaceLink(Action.EDIT, false, id, null) : null;
            }
            return new WorkspaceLink(Action.EDIT, false, 0, target);
        }
        switch (text.toLowerCase(Locale.ROOT)) {
            case "home":
                return new WorkspaceLink(Action.HOME, newTab, 0, null);
            case "back":
                return newTab ? null : new WorkspaceLink(Action.BACK, false, 0, null);
            case "forward":
                return newTab ? null : new WorkspaceLink(Action.FORWARD, false, 0, null);
            default:
                break;
        }
        if (text.matches("\\d{1,9}")) {
            int id = Integer.parseInt(text);
            return id > 0 ? new WorkspaceLink(Action.OPEN, newTab, id, null) : null;
        }
        return new WorkspaceLink(Action.OPEN, newTab, 0, text);
    }

    @Override
    public String toString() {
        return action + (newTab ? " tab" : "") + (id > 0 ? " #" + id : "") + (name != null ? " \"" + name + "\"" : "");
    }
}
