package com.fbi.plugins.reportbtn.editor;

import javax.swing.GrayFilter;
import javax.swing.Icon;
import javax.swing.ImageIcon;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.Image;
import java.awt.Toolkit;
import java.awt.image.BufferedImage;
import java.awt.image.FilteredImageSource;
import java.awt.image.RGBImageFilter;
import java.util.HashMap;
import java.util.Map;

/**
 * The Apps panel's record icons, as Fishbowl's report tree shows reports: a page icon,
 * black for a system app and green for a custom one, grey when inactive. Built from
 * the client's own green page icon, so all three have its shape. Other records keep
 * their type icon, greyed when inactive.
 */
final class AppIcons {

    /** Text of things that are there but not in use: empty folders, unpublished apps. */
    static final Color MUTED = Color.GRAY;

    private static final String PAGE = "/side_toolbar/page_green16.png";
    private static Icon custom;
    private static Icon system;
    private static Icon inactive;
    private static final Map<Icon, Icon> GREYED = new HashMap<>();

    private AppIcons() {
    }

    /** An app's icon; null when the client's page icon isn't there (the caller keeps its own). */
    static synchronized Icon app(boolean isSystem, boolean active) {
        if (custom == null) {
            Icon base = EditorFeature.icon(PAGE, 16);
            if (base == null) {
                return null;
            }
            custom = base;
            system = recolor(base, 0.28, 0);      // the green body, darkened to near black
            inactive = recolor(base, 0.28, 128);  // ... and lifted to a light grey
        }
        return !active ? inactive : isSystem ? system : custom;
    }

    /** A type icon greyed, as Swing greys a disabled one. */
    static synchronized Icon greyed(Icon icon) {
        if (icon == null) {
            return null;
        }
        return GREYED.computeIfAbsent(icon, i -> new ImageIcon(GrayFilter.createDisabledImage(image(i))));
    }

    /**
     * Each coloured pixel becomes grey: its brightness times scale, plus lift. Near-white
     * pixels (the page's lines) and transparency stay as they are.
     */
    private static Icon recolor(Icon base, double scale, int lift) {
        RGBImageFilter f = new RGBImageFilter() {
            @Override
            public int filterRGB(int x, int y, int argb) {
                int a = argb >>> 24, r = (argb >> 16) & 0xFF, g = (argb >> 8) & 0xFF, b = argb & 0xFF;
                if (a == 0 || Math.min(r, Math.min(g, b)) > 215) {
                    return argb;
                }
                int v = Math.min(255, lift + (int) Math.round((0.299 * r + 0.587 * g + 0.114 * b) * scale));
                return (a << 24) | (v << 16) | (v << 8) | v;
            }
        };
        Image img = Toolkit.getDefaultToolkit().createImage(new FilteredImageSource(image(base).getSource(), f));
        return new ImageIcon(img);
    }

    private static Image image(Icon icon) {
        if (icon instanceof ImageIcon) {
            return ((ImageIcon) icon).getImage();
        }
        BufferedImage img = new BufferedImage(Math.max(1, icon.getIconWidth()), Math.max(1, icon.getIconHeight()),
            BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        icon.paintIcon(null, g, 0, 0);
        g.dispose();
        return img;
    }
}
