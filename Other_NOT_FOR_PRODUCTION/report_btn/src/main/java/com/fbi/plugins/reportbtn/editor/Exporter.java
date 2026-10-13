package com.fbi.plugins.reportbtn.editor;

import com.evnt.client.common.ClientProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fbi.fbdata.bi.BiScriptFpo;
import com.fbi.json.FishbowlJsonMapper;
import com.fbi.util.PropertyConst;

import javax.swing.JFileChooser;
import javax.swing.JOptionPane;
import java.awt.Component;
import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

/**
 * Download, as the BI Editor's Download button does it: the records go to a folder
 * the user picks, one "<name>-<Type>.json" each (a one-element list, Fishbowl's own
 * JSON mapper, indented), and the folder is remembered as LAST_FILE_PATH. The BI
 * Editor's Import reads these files back.
 */
final class Exporter {

    private Exporter() {
    }

    /** The JSON mapper the BI Editor module builds: FishbowlJsonMapper, indented. */
    static ObjectMapper mapper() {
        ObjectMapper m = new FishbowlJsonMapper();
        m.enable(SerializationFeature.INDENT_OUTPUT);
        return m;
    }

    /** Asks for a folder and writes each record; returns how many were written (0 if cancelled). */
    static int write(Component parent, Collection<BiScriptFpo> records) {
        if (records.isEmpty()) {
            return 0;
        }
        JFileChooser chooser = new JFileChooser();
        String last = ClientProperties.getProperty(PropertyConst.LAST_FILE_PATH);
        if (last != null && !last.isEmpty()) {
            chooser.setCurrentDirectory(new File(last));
        }
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        chooser.setDialogTitle("Download " + records.size() + " record" + (records.size() == 1 ? "" : "s") + " to a folder");
        if (chooser.showSaveDialog(parent) != JFileChooser.APPROVE_OPTION || chooser.getSelectedFile() == null) {
            return 0;
        }
        File dir = chooser.getSelectedFile();
        ClientProperties.setProperty(PropertyConst.LAST_FILE_PATH, dir.getAbsolutePath());
        ClientProperties.saveProperties();

        List<File> existing = new ArrayList<>();
        for (BiScriptFpo r : records) {
            File f = new File(dir, fileName(r));
            if (f.exists()) {
                existing.add(f);
            }
        }
        if (!existing.isEmpty()) {
            StringBuilder names = new StringBuilder();
            for (int i = 0; i < Math.min(8, existing.size()); i++) {
                names.append("<br>").append(Completions.esc(existing.get(i).getName()));
            }
            if (existing.size() > 8) {
                names.append("<br>… and ").append(existing.size() - 8).append(" more");
            }
            if (JOptionPane.showConfirmDialog(parent, "<html>Overwrite " + existing.size() + " existing file"
                + (existing.size() == 1 ? "" : "s") + " in " + Completions.esc(dir.getName()) + "?" + names + "</html>",
                "Download", JOptionPane.YES_NO_OPTION, JOptionPane.WARNING_MESSAGE) != JOptionPane.YES_OPTION) {
                return 0;
            }
        }
        ObjectMapper m = mapper();
        int n = 0;
        for (BiScriptFpo r : records) {
            File f = new File(dir, fileName(r));
            try {
                m.writeValue(f, Collections.singletonList(r));
                n++;
            } catch (IOException e) {
                JOptionPane.showMessageDialog(parent, "Couldn't write " + f.getName() + ": " + e.getMessage(), "Download",
                    JOptionPane.ERROR_MESSAGE);
                return n;
            }
        }
        JOptionPane.showMessageDialog(parent, "Saved " + n + " file" + (n == 1 ? "" : "s") + " to " + dir.getAbsolutePath() + ".",
            "Download", JOptionPane.INFORMATION_MESSAGE);
        return n;
    }

    /** "<name>-<Type>.json", as the BI Editor names it, with characters Windows refuses replaced. */
    static String fileName(BiScriptFpo r) {
        String type = r.getType() == null ? "Page" : r.getType().getName();
        String name = r.getName() == null ? "untitled" : r.getName();
        return (name + "-" + type).replaceAll("[\\\\/:*?\"<>|]", "_") + ".json";
    }
}
