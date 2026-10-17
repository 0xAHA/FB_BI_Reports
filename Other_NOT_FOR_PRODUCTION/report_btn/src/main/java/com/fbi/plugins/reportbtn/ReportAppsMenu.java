package com.fbi.plugins.reportbtn;

import com.evnt.client.Client;
import com.evnt.client.modules.ClientModuleImpl;
import com.fbi.sdk.constants.MenuGroupNameConst;

import javax.swing.JComponent;
import javax.swing.JMenu;
import javax.swing.JMenuItem;
import javax.swing.JPopupMenu;
import javax.swing.SwingUtilities;
import javax.swing.Timer;
import javax.swing.event.MenuEvent;
import javax.swing.event.MenuListener;
import java.awt.Component;
import java.awt.Frame;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Hooks the main window's Reports menu.
 *
 * The client rebuilds that menu from scratch every time a module is activated
 * (Client.updateReportMenu: removeAll, then "My Reports" / "Company Reports"
 * from the module's report list), so the Apps section is appended each time the
 * menu opens rather than once. updateReportMenu also disables the menu when the
 * module has no reports and the user lacks Reports rights; the "enabled"
 * listener turns it back on while the module has reports to list.
 */
final class ReportAppsMenu {

    private static final String INSTALLED = "reportbtn.installed";
    private static final String OURS = "reportbtn.item";
    private static final int INSTALL_RETRIES = 10;

    private static Field reportMenuField;
    private static Method currentModuleMethod;

    private ReportAppsMenu() {
    }

    static void install() {
        install(INSTALL_RETRIES);
    }

    private static void install(int retriesLeft) {
        try {
            JMenu menu = reportMenu();
            if (menu == null) {
                if (retriesLeft > 0) {
                    Timer retry = new Timer(2000, e -> install(retriesLeft - 1));
                    retry.setRepeats(false);
                    retry.start();
                } else {
                    ReportAppsPlugin.log("Reports menu not found; Apps not installed");
                }
                return;
            }
            if (Boolean.TRUE.equals(menu.getClientProperty(INSTALLED))) {
                return;   // a re-login re-creates the plugin, not the menu
            }
            menu.putClientProperty(INSTALLED, Boolean.TRUE);
            menu.addMenuListener(new MenuListener() {
                @Override
                public void menuSelected(MenuEvent e) {
                    refresh(menu);
                }

                @Override
                public void menuDeselected(MenuEvent e) {
                }

                @Override
                public void menuCanceled(MenuEvent e) {
                }
            });
            menu.addPropertyChangeListener("enabled", e -> {
                if (Boolean.FALSE.equals(e.getNewValue())) {
                    SwingUtilities.invokeLater(() -> keepEnabled(menu));
                }
            });
            AppCatalog.warm();
            ReportAppsPlugin.log("Apps installed on the Reports menu");
        } catch (Exception e) {
            ReportAppsPlugin.log("Installing the Apps menu failed", e);
        }
    }

    /**
     * Re-adds the Apps section for the current module:
     *   Apps                 header, styled like the client's own
     *   <reports>            those whose fb-launch tag names this module's key or
     *                        its menu group (split past MAX_ITEMS)
     * Nothing is added when no report names the module.
     */
    private static void refresh(JMenu menu) {
        try {
            removeOurs(menu);
            ClientModuleImpl module = currentModule();
            if (module == null) {
                return;
            }
            List<AppCatalog.App> apps = AppCatalog.forModule(keys(module));
            if (apps.isEmpty()) {
                return;
            }
            if (menu.getMenuComponentCount() > 0) {
                menu.add(ours(new JPopupMenu.Separator()));
            }
            JMenuItem header = new JMenuItem("<html><font color=black><u>Apps</u></font></html>");
            header.setEnabled(false);
            menu.add(ours(header));
            addItems(menu, apps, module, true);
        } catch (Exception e) {
            ReportAppsPlugin.log("Building the Apps section failed", e);
        }
    }

    /** The tag keys that list a report in this module: its own key and its menu group. */
    static Set<String> keys(ClientModuleImpl module) {
        Set<String> keys = new HashSet<>();
        keys.add(ModuleCodes.of(module.getModuleName()).tag);
        MenuGroupNameConst group = module.getMenuGroupConst();
        if (group != null) {
            keys.add(group.name());   // SALES, PURCHASING, MATERIALS, MANUFACTURING, …
        }
        return keys;
    }

    private static final int MAX_ITEMS = 30;   // longer lists are split so the popup fits the screen

    /** Adds the reports, split into "first … last" submenus past MAX_ITEMS. */
    private static void addItems(JMenu parent, List<AppCatalog.App> apps, ClientModuleImpl module, boolean topLevel) {
        if (apps.size() <= MAX_ITEMS) {
            for (AppCatalog.App app : apps) {
                JMenuItem item = item(app, module);
                parent.add(topLevel ? ours(item) : item);
            }
            return;
        }
        for (int from = 0; from < apps.size(); from += MAX_ITEMS) {
            List<AppCatalog.App> chunk = apps.subList(from, Math.min(from + MAX_ITEMS, apps.size()));
            JMenu sub = new JMenu(shortLabel(chunk.get(0).name) + " … " + shortLabel(chunk.get(chunk.size() - 1).name));
            addItems(sub, chunk, module, false);
            parent.add(topLevel ? ours(sub) : sub);
        }
    }

    private static String shortLabel(String label) {
        String s = label.replaceFirst("^[\\s-]+", "");   // drop the "- " sort prefix
        return s.length() <= 14 ? s : s.substring(0, 13) + "…";
    }

    private static JMenuItem item(AppCatalog.App app, ClientModuleImpl module) {
        JMenuItem item = new JMenuItem(app.name);
        if (!app.description.isEmpty() && !app.description.equals(app.name)) {
            item.setToolTipText(app.description);
        }
        item.addActionListener(e -> AppLauncher.launch(app, module));
        return item;
    }

    private static void keepEnabled(JMenu menu) {
        try {
            if (menu.isEnabled()) {
                return;
            }
            ClientModuleImpl module = currentModule();
            if (module != null && !AppCatalog.forModule(keys(module)).isEmpty()) {
                menu.setEnabled(true);
            }
        } catch (Exception e) {
            ReportAppsPlugin.log("Re-enabling the Reports menu failed", e);
        }
    }

    private static <T extends JComponent> T ours(T component) {
        component.putClientProperty(OURS, Boolean.TRUE);
        return component;
    }

    private static void removeOurs(JMenu menu) {
        for (Component c : menu.getMenuComponents()) {
            if (c instanceof JComponent && Boolean.TRUE.equals(((JComponent) c).getClientProperty(OURS))) {
                menu.remove(c);
            }
        }
    }

    static Client client() {
        for (Frame frame : Frame.getFrames()) {
            if (frame instanceof Client) {
                return (Client) frame;
            }
        }
        return null;
    }

    // Client.reportMenu and Client.getCurrentModule() are private.
    private static JMenu reportMenu() throws ReflectiveOperationException {
        Client client = client();
        if (client == null) {
            return null;
        }
        if (reportMenuField == null) {
            Field f = Client.class.getDeclaredField("reportMenu");
            f.setAccessible(true);
            reportMenuField = f;
        }
        Object menu = reportMenuField.get(client);
        return menu instanceof JMenu ? (JMenu) menu : null;
    }

    static ClientModuleImpl currentModule() throws ReflectiveOperationException {
        Client client = client();
        if (client == null) {
            return null;
        }
        if (currentModuleMethod == null) {
            Method m = Client.class.getDeclaredMethod("getCurrentModule");
            m.setAccessible(true);
            currentModuleMethod = m;
        }
        return (ClientModuleImpl) currentModuleMethod.invoke(client);
    }
}
