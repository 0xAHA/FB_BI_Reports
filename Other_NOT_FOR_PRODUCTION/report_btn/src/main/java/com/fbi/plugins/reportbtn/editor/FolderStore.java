package com.fbi.plugins.reportbtn.editor;

import com.fbi.plugins.FishbowlPlugin;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The folders users create in the Apps panel, so a folder can exist before any app
 * is in it. One list for the whole company, in the plugin's own properties on the
 * server (FishbowlPlugin.getPluginProperty / savePluginProperties), one name per
 * line. Changing it needs Reports-CompanyEdit, the right for Fishbowl's own report
 * tree. A folder that apps use exists anyway; this list only adds empty ones.
 */
final class FolderStore {

    private static final String KEY = "editor.appFolders";

    private FolderStore() {
    }

    static List<String> read(FishbowlPlugin plugin) {
        List<String> out = new ArrayList<>();
        try {
            String v = plugin == null ? null : plugin.getPluginProperty(KEY);
            if (v != null) {
                for (String line : v.split("\n")) {
                    if (!line.trim().isEmpty()) {
                        out.add(line.trim());
                    }
                }
            }
        } catch (RuntimeException | LinkageError ignored) {
            // no plugin properties here (a desk test): no created folders
        }
        return out;
    }

    /** Saves the list (deduplicated, case-insensitively); throws with a message on failure. */
    static void write(FishbowlPlugin plugin, List<String> folders) throws ScriptService.ServiceException {
        Set<String> seen = new LinkedHashSet<>();
        List<String> keep = new ArrayList<>();
        for (String f : folders) {
            if (f != null && !f.trim().isEmpty() && seen.add(f.trim().toLowerCase())) {
                keep.add(f.trim());
            }
        }
        Map<String, String> props = new HashMap<>();
        props.put(KEY, String.join("\n", keep));
        try {
            plugin.savePluginProperties(props);
        } catch (RuntimeException | LinkageError e) {
            throw new ScriptService.ServiceException("Couldn't save the folder list: " + e.getMessage());
        }
    }
}
