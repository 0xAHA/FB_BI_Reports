package com.fbi.plugins.reportbtn.docs;

import com.evnt.client.modules.ClientModuleImpl;
import com.fbi.plugins.FishbowlPluginButton;

import javax.swing.Icon;
import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import javax.swing.SwingConstants;
import java.awt.Container;
import java.awt.event.HierarchyEvent;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The Print (App) and Email (rich) buttons in the module ribbons. The client finds
 * every concrete FishbowlPluginButton in the plugin packages, makes one with its
 * no-argument constructor, and adds it to the module whose name it gives, so each
 * module has a pair of tiny classes below. The stock Print and Email are untouched.
 *
 * Print (App) shows only while one of the module's documents has an app (checked
 * when the module's ribbon is rebuilt); Email (rich) always, attaching the app's
 * PDF or else the Jasper default's.
 */
public final class DocButtons {

    private DocButtons() {
    }

    private static final long CACHE_MS = 10000;
    private static volatile Map<String, String> cachedApps;
    private static volatile long cachedAt;

    /** slot -> app, re-read at most every ten seconds (every ribbon rebuild asks). */
    static Map<String, String> apps(boolean fresh) {
        if (fresh || cachedApps == null || System.currentTimeMillis() - cachedAt > CACHE_MS) {
            cachedApps = DocDefaults.apps();
            cachedAt = System.currentTimeMillis();
        }
        return cachedApps;
    }

    abstract static class Base extends FishbowlPluginButton {
        private final boolean print;
        private final DocSlots.Module module;

        Base(String moduleName, boolean print) {
            this.print = print;
            this.module = DocSlots.module(moduleName);
            setModuleName(moduleName);
            setPluginName(DocDefaults.PLUGIN);
            setText(print ? "Print (App)" : "Email (rich)");
            setToolTipText(print ? "Print this " + module.noun + " with the app set as its document (documents PoC)"
                : "Email this " + module.noun + "'s document in the rich email window (documents PoC)");
            Icon icon = Docs.icon(print ? "/toolbar/printer24.png" : "/toolbar/email24.png", 24);
            if (icon != null) {
                setIcon(icon);
            }
            setVerticalTextPosition(SwingConstants.BOTTOM);
            setHorizontalTextPosition(SwingConstants.CENTER);
            setFocusable(false);
            if (Docs.off()) {
                setVisible(false);
                return;
            }
            addActionListener(e -> clicked());
            if (print) {
                setVisible(false);
                // The ribbon is rebuilt from the module's toolbar on every visit, which re-parents
                // this button even while it is hidden: the moment to look at the settings again.
                addHierarchyListener(e -> {
                    if ((e.getChangeFlags() & (HierarchyEvent.PARENT_CHANGED | HierarchyEvent.SHOWING_CHANGED)) != 0) {
                        refreshVisible();
                    }
                });
            }
        }

        private void refreshVisible() {
            boolean any = false;
            try {
                Map<String, String> apps = apps(false);
                for (DocSlots.Slot s : module.slots) {
                    any |= apps.containsKey(s.name);
                }
            } catch (RuntimeException e) {
                any = false;
            }
            if (any != isVisible()) {
                setVisible(any);
                Container p = getParent();
                if (p != null) {
                    p.revalidate();
                    p.repaint();
                }
            }
        }

        private ClientModuleImpl clientModule() {
            try {
                Object m = Docs.field(this, "clientModule");
                return m instanceof ClientModuleImpl ? (ClientModuleImpl) m : null;
            } catch (ReflectiveOperationException e) {
                return null;
            }
        }

        private void clicked() {
            Map<String, String> apps = apps(true);
            List<DocSlots.Slot> choices = new ArrayList<>();
            for (DocSlots.Slot s : module.slots) {
                if (apps.containsKey(s.name) || (!print && s.main())) {
                    choices.add(s);
                }
            }
            if (choices.isEmpty()) {
                Docs.info(this, "No app is set as a " + module.noun + " document. An admin can set one under Apps (beta) › Documents.");
                return;
            }
            if (choices.size() == 1) {
                run(choices.get(0), apps.get(choices.get(0).name));
                return;
            }
            JPopupMenu menu = new JPopupMenu();
            for (DocSlots.Slot s : choices) {
                String app = apps.get(s.name);
                JMenuItem item = new JMenuItem(s.title + (app != null ? "  (" + app + ")" : "  (Jasper default)"));
                item.addActionListener(e -> run(s, app));
                menu.add(item);
            }
            menu.show(this, 0, getHeight());
        }

        private void run(DocSlots.Slot slot, String app) {
            ClientModuleImpl m = clientModule();
            if (m == null) {
                Docs.error(this, "This button isn't attached to its module.");
                return;
            }
            try {
                if (!m.checkForSave()) {
                    return;
                }
            } catch (RuntimeException ignored) {
                // nothing to save
            }
            int id = getObjectId();
            if (id <= 0) {
                Docs.info(this, "Open (and save) a " + module.noun + " first.");
                return;
            }
            String num = Docs.one("SELECT num AS num FROM " + module.table + " WHERE id = " + id, "num");
            if (print) {
                DocumentWindow.open(this, m, slot, app, id, num);
            } else if (app != null) {
                DocumentRenderer.app(this, slot, app, id, num, pdf -> EmailFlow.start(this, slot, id, num, pdf));
            } else {
                File pdf;
                try {
                    pdf = DocumentRenderer.jasper(m, slot, num);
                } catch (Exception e) {
                    Docs.log("the Jasper PDF for " + slot.name + " failed", e);
                    Docs.error(this, e.getMessage());
                    return;
                }
                EmailFlow.start(this, slot, id, num, pdf);
            }
        }
    }

    // ---- one pair per module (the client matches buttons to modules by name)

    public static final class SalesOrderPrint extends Base {
        public SalesOrderPrint() { super("Sales Order", true); }
    }

    public static final class SalesOrderEmail extends Base {
        public SalesOrderEmail() { super("Sales Order", false); }
    }

    public static final class PurchaseOrderPrint extends Base {
        public PurchaseOrderPrint() { super("Purchase Order", true); }
    }

    public static final class PurchaseOrderEmail extends Base {
        public PurchaseOrderEmail() { super("Purchase Order", false); }
    }

    public static final class PickingPrint extends Base {
        public PickingPrint() { super("Picking", true); }
    }

    public static final class PickingEmail extends Base {
        public PickingEmail() { super("Picking", false); }
    }

    public static final class ShippingPrint extends Base {
        public ShippingPrint() { super("Shipping", true); }
    }

    public static final class ShippingEmail extends Base {
        public ShippingEmail() { super("Shipping", false); }
    }

    public static final class WorkOrderPrint extends Base {
        public WorkOrderPrint() { super("Work Order", true); }
    }

    public static final class WorkOrderEmail extends Base {
        public WorkOrderEmail() { super("Work Order", false); }
    }

    public static final class ManufactureOrderPrint extends Base {
        public ManufactureOrderPrint() { super("Manufacture Order", true); }
    }

    public static final class ManufactureOrderEmail extends Base {
        public ManufactureOrderEmail() { super("Manufacture Order", false); }
    }

    public static final class TransferOrderPrint extends Base {
        public TransferOrderPrint() { super("Transfer Order", true); }
    }

    public static final class TransferOrderEmail extends Base {
        public TransferOrderEmail() { super("Transfer Order", false); }
    }

    public static final class RmaPrint extends Base {
        public RmaPrint() { super("RMA", true); }
    }

    public static final class RmaEmail extends Base {
        public RmaEmail() { super("RMA", false); }
    }
}
