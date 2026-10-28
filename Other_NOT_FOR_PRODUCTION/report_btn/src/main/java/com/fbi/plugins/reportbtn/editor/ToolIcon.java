package com.fbi.plugins.reportbtn.editor;

import javax.swing.Icon;
import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Component;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.geom.RoundRectangle2D;

/**
 * 16 px line icons for the editor toolbar's view toggles, which Fishbowl has no image
 * for: the Apps panel (a window with its side panel on the left), the Insert panel (on
 * the right) and line wrap. Drawn in the grey of the workspace toolbar's own painted
 * icons; a toggle that is on shows it in blue.
 */
final class ToolIcon implements Icon {

    enum Kind { APPS_PANEL, INSERT_PANEL, WRAP }

    private static final int SIZE = 16;
    private static final Color OFF = new Color(0x41, 0x51, 0x57);
    private static final Color ON = new Color(0x1F, 0x7F, 0xC4);
    private static final Color DISABLED = new Color(0xB4, 0xBE, 0xC2);

    private final Kind kind;
    private final Color color;

    private ToolIcon(Kind kind, Color color) {
        this.kind = kind;
        this.color = color;
    }

    static Icon off(Kind kind) {
        return new ToolIcon(kind, OFF);
    }

    static Icon on(Kind kind) {
        return new ToolIcon(kind, ON);
    }

    static Icon disabled(Kind kind) {
        return new ToolIcon(kind, DISABLED);
    }

    @Override
    public int getIconWidth() {
        return SIZE;
    }

    @Override
    public int getIconHeight() {
        return SIZE;
    }

    @Override
    public void paintIcon(Component c, Graphics g, int x, int y) {
        Graphics2D g2 = (Graphics2D) g.create();
        try {
            g2.translate(x, y);
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g2.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            g2.setColor(color);
            g2.setStroke(new BasicStroke(1.5f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            Path2D p = new Path2D.Float();
            switch (kind) {
                case APPS_PANEL:
                case INSERT_PANEL: {
                    // A window, its side panel shaded with a short list in it.
                    boolean left = kind == Kind.APPS_PANEL;
                    float side = left ? 1.5f : 10f;
                    float divider = left ? 6f : 10f;
                    java.awt.Composite was = g2.getComposite();
                    g2.setComposite(AlphaComposite.getInstance(AlphaComposite.SRC_OVER, 0.3f));
                    g2.fill(new Rectangle2D.Float(side, 2.5f, 4.5f, 11f));
                    g2.setComposite(was);
                    g2.draw(new RoundRectangle2D.Float(1.5f, 2.5f, 13f, 11f, 3f, 3f));
                    p.moveTo(divider, 2.5); p.lineTo(divider, 13.5);
                    float a = side + 1.3f, b = side + 3.2f;
                    for (float row : new float[]{5.5f, 8f, 10.5f}) {
                        p.moveTo(a, row); p.lineTo(b, row);
                    }
                    g2.draw(p);
                    break;
                }
                case WRAP:
                    // Two lines of text, the second running on round the edge onto the third.
                    p.moveTo(1.5, 3.5); p.lineTo(14.5, 3.5);
                    p.moveTo(1.5, 8); p.lineTo(11.5, 8);
                    p.quadTo(14.5, 8, 14.5, 10.25);
                    p.quadTo(14.5, 12.5, 11.5, 12.5);
                    p.lineTo(8, 12.5);
                    p.moveTo(10, 10.5); p.lineTo(8, 12.5); p.lineTo(10, 14.5);
                    p.moveTo(1.5, 12.5); p.lineTo(5, 12.5);
                    g2.draw(p);
                    break;
                default:
                    break;
            }
        } finally {
            g2.dispose();
        }
    }
}
