package com.fbi.plugins.reportbtn;

import javax.swing.Icon;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Component;
import java.awt.Graphics;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.geom.Path2D;
import java.awt.geom.RoundRectangle2D;

/**
 * 24 px line icons for the Report Workspace toolbar. Fishbowl ships no Back,
 * Forward or Home toolbar image, so these are drawn, in the grey of the
 * client's own toolbar icons.
 */
final class PaintedIcon implements Icon {

    enum Kind { BACK, FORWARD, HOME, NEW_TAB }

    private static final int SIZE = 24;
    private static final Color ENABLED = new Color(0x41, 0x51, 0x57);
    private static final Color DISABLED = new Color(0xB4, 0xBE, 0xC2);

    private final Kind kind;
    private final Color color;

    private PaintedIcon(Kind kind, Color color) {
        this.kind = kind;
        this.color = color;
    }

    static Icon of(Kind kind) {
        return new PaintedIcon(kind, ENABLED);
    }

    static Icon disabled(Kind kind) {
        return new PaintedIcon(kind, DISABLED);
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
            g2.setStroke(new BasicStroke(2f, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND));
            Path2D p = new Path2D.Float();
            switch (kind) {
                case BACK:
                    p.moveTo(19, 12); p.lineTo(5, 12);
                    p.moveTo(11, 6); p.lineTo(5, 12); p.lineTo(11, 18);
                    g2.draw(p);
                    break;
                case FORWARD:
                    p.moveTo(5, 12); p.lineTo(19, 12);
                    p.moveTo(13, 6); p.lineTo(19, 12); p.lineTo(13, 18);
                    g2.draw(p);
                    break;
                case HOME:
                    p.moveTo(3, 11.5); p.lineTo(12, 3.5); p.lineTo(21, 11.5);
                    p.moveTo(5.5, 9.5); p.lineTo(5.5, 20.5); p.lineTo(18.5, 20.5); p.lineTo(18.5, 9.5);
                    p.moveTo(10, 20.5); p.lineTo(10, 14.5); p.lineTo(14, 14.5); p.lineTo(14, 20.5);
                    g2.draw(p);
                    break;
                case NEW_TAB:
                    g2.draw(new RoundRectangle2D.Float(3, 5, 18, 15, 4, 4));
                    p.moveTo(12, 8.5); p.lineTo(12, 16.5);
                    p.moveTo(8, 12.5); p.lineTo(16, 12.5);
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
