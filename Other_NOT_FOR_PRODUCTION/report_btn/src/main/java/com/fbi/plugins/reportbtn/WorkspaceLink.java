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
 *   drop:[{"name":"x.htm","text":"..."}, ...]
 *                    files dropped on the App Library, for the page editor
 *
 * Keywords and prefixes ignore case. An empty item only switches to the
 * workspace, so it parses to null, as does anything unusable.
 */
final class WorkspaceLink {

    enum Action { OPEN, HOME, BACK, FORWARD, EDIT, BUILD, DROP }

    private static final String TAB = "tab:";
    private static final String EDIT = "edit:";
    /** build:<verb>[:<arg>], for the Report Builder (e.g. build:publish:<nonce>). */
    private static final String BUILD = "build:";
    /** drop:<json>, files dropped on the App Library (the JSON is in name). */
    private static final String DROP = "drop:";

    final Action action;
    final boolean newTab;
    /** The report id, or 0 when the report is named. */
    final int id;
    /** The report name, or null when the report is an id. */
    final String name;
    /** A build: link's argument (letters, digits, - and _), or null. */
    final String arg;

    private WorkspaceLink(Action action, boolean newTab, int id, String name) {
        this(action, newTab, id, name, null);
    }

    private WorkspaceLink(Action action, boolean newTab, int id, String name, String arg) {
        this.action = action;
        this.newTab = newTab;
        this.id = id;
        this.name = name;
        this.arg = arg;
    }

    static WorkspaceLink parse(String item) {
        if (item == null) {
            return null;
        }
        String text = item.trim();
        if (text.regionMatches(true, 0, DROP, 0, DROP.length())) {
            String json = text.substring(DROP.length()).trim();
            return json.startsWith("[") ? new WorkspaceLink(Action.DROP, false, 0, json) : null;
        }
        boolean newTab = false;
        if (text.regionMatches(true, 0, TAB, 0, TAB.length())) {
            newTab = true;
            text = text.substring(TAB.length()).trim();
        }
        if (text.isEmpty()) {
            return null;
        }
        // build:<verb>[:<arg>] (the Report Builder's own requests); name is the verb.
        if (text.regionMatches(true, 0, BUILD, 0, BUILD.length())) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("([a-z]{1,20})(?::([A-Za-z0-9_-]{1,64}))?").matcher(text.substring(BUILD.length()).trim());
            return m.matches() ? new WorkspaceLink(Action.BUILD, false, 0, m.group(1), m.group(2)) : null;
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
        if (action == Action.BUILD) {
            return "BUILD " + name + (arg != null ? " " + arg : "");
        }
        return action + (newTab ? " tab" : "") + (id > 0 ? " #" + id : "") + (name != null ? " \"" + name + "\"" : "");
    }
}
