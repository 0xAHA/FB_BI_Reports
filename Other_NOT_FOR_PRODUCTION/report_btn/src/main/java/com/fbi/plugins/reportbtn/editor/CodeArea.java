package com.fbi.plugins.reportbtn.editor;

import org.fife.ui.rsyntaxtextarea.RSyntaxTextArea;
import org.fife.ui.rsyntaxtextarea.SyntaxConstants;
import org.fife.ui.rsyntaxtextarea.Theme;

import javax.swing.UIManager;
import java.awt.Color;
import java.awt.Font;
import java.awt.GraphicsEnvironment;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;

/**
 * The code area: RSyntaxTextArea (already on the client's classpath; Fishbowl's own
 * FBTextArea extends it). HTML highlighting covers a page's embedded JS and CSS.
 * The theme follows the client's background: idea when light, dark when dark.
 */
final class CodeArea {

    private CodeArea() {
    }

    static RSyntaxTextArea create(int typeId) {
        RSyntaxTextArea a = new RSyntaxTextArea(30, 100);
        a.setSyntaxEditingStyle(style(typeId));
        a.setCodeFoldingEnabled(true);
        a.setMarkOccurrences(true);
        a.setBracketMatchingEnabled(true);
        a.setAnimateBracketMatching(true);
        a.setPaintTabLines(true);
        a.setTabSize(4);
        a.setTabsEmulated(true);   // the repo's pages use spaces
        a.setAntiAliasingEnabled(true);
        a.setAutoIndentEnabled(true);
        if (typeId == 10 || typeId == 40) {
            a.setCloseMarkupTags(true);
        }
        Font font = monospace(13);
        String theme = dark() ? "dark.xml" : "idea.xml";
        try (InputStream in = RSyntaxTextArea.class.getResourceAsStream("/org/fife/ui/rsyntaxtextarea/themes/" + theme)) {
            if (in != null) {
                Theme.load(in, font).apply(a);
            }
        } catch (Exception ignored) {
            a.setFont(font);   // the default theme, with a monospace font
        }
        // The shading behind embedded JS and CSS: the theme's tints, mostly faded into the background.
        Color bg = a.getBackground();
        for (int i = 1; i <= a.getSecondaryLanguageCount(); i++) {
            Color c = a.getSecondaryLanguageBackground(i);
            if (c != null && bg != null) {
                a.setSecondaryLanguageBackground(i, mix(c, bg, SHADE_FADE));
            }
        }
        return a;
    }

    /**
     * Long lines wrap at the editor's width (on by default; the toolbar's Wrap toggle),
     * breaking between words where it can rather than mid-identifier.
     */
    static void wrap(RSyntaxTextArea a, boolean on) {
        a.setLineWrap(on);
        a.setWrapStyleWord(on);
    }

    /** How far the embedded-language shading fades towards the background (0 = the theme's, 1 = none). */
    private static final double SHADE_FADE = 0.6;

    private static Color mix(Color c, Color toward, double t) {
        return new Color((int) Math.round(c.getRed() + (toward.getRed() - c.getRed()) * t),
            (int) Math.round(c.getGreen() + (toward.getGreen() - c.getGreen()) * t),
            (int) Math.round(c.getBlue() + (toward.getBlue() - c.getBlue()) * t));
    }

    static String style(int typeId) {
        switch (typeId) {
            case 20: return SyntaxConstants.SYNTAX_STYLE_JAVASCRIPT;
            case 30: return SyntaxConstants.SYNTAX_STYLE_CSS;
            default: return SyntaxConstants.SYNTAX_STYLE_HTML;
        }
    }

    private static boolean dark() {
        Color bg = UIManager.getColor("Panel.background");
        if (bg == null) {
            return false;
        }
        double lum = (0.299 * bg.getRed() + 0.587 * bg.getGreen() + 0.114 * bg.getBlue()) / 255;
        return lum < 0.45;
    }

    static Font monospace(int size) {
        List<String> installed = Arrays.asList(GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames());
        for (String name : new String[]{"Cascadia Mono", "Consolas", "JetBrains Mono", "DejaVu Sans Mono", "Menlo"}) {
            if (installed.contains(name)) {
                return new Font(name, Font.PLAIN, size);
            }
        }
        return new Font(Font.MONOSPACED, Font.PLAIN, size);
    }
}
