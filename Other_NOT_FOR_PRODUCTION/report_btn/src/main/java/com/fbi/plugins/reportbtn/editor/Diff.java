package com.fbi.plugins.reportbtn.editor;

import com.evnt.common.swing.swingutil.dialogs.DiffDialog;
import com.jidesoft.editor.tokenmarker.HTMLTokenMarker;
import com.jidesoft.editor.tokenmarker.JavaScriptTokenMarker;
import com.jidesoft.editor.tokenmarker.TokenMarker;

import java.awt.Component;

/** Fishbowl's own side-by-side diff (the one the BI Editor's history uses). */
final class Diff {

    private Diff() {
    }

    static void show(Component parent, int typeId, String leftTitle, String left, String rightTitle, String right) {
        DiffDialog d = new DiffDialog(marker(typeId));
        // setData(fromText, fromTitle, toText, toTitle): text first (probed on 26.9.1).
        d.setData(left == null ? "" : left, leftTitle, right == null ? "" : right, rightTitle);
        d.setLocationRelativeTo(parent);
        d.setVisible(true);
    }

    private static TokenMarker marker(int typeId) {
        if (typeId == 20) {
            return new JavaScriptTokenMarker();
        }
        if (typeId == 30) {
            try {
                return (TokenMarker) Class.forName("com.fbi.gui.util.CSSTokenMarker").getDeclaredConstructor().newInstance();
            } catch (ReflectiveOperationException | RuntimeException e) {
                return new JavaScriptTokenMarker();
            }
        }
        return new HTMLTokenMarker();
    }
}
