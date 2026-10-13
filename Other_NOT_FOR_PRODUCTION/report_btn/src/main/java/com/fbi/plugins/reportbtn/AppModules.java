package com.fbi.plugins.reportbtn;

import com.evnt.client.Client;

import java.lang.reflect.Field;
import java.util.HashMap;
import java.util.Map;

/**
 * Lets the client find app tabs by name. Its Save Bookmark stores the open main
 * tabs' module names, and at login it reopens each through its module map
 * (Client.modules, private). App tabs are made on demand, so the map is swapped
 * for one that makes an AppModule when asked for an "Apps (beta)-..." name it
 * doesn't hold yet. Everything else behaves as the client's own HashMap.
 */
final class AppModules {

    private AppModules() {
    }

    /** Swaps the client's module map once (again after a re-login builds a new one). */
    static void install() {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return;
        }
        try {
            Field f = Client.class.getDeclaredField("modules");
            f.setAccessible(true);
            Object current = f.get(client);
            if (current instanceof OnDemand || !(current instanceof HashMap)) {
                return;
            }
            @SuppressWarnings("unchecked")
            Map<Object, Object> old = (Map<Object, Object>) current;
            OnDemand map = new OnDemand();
            map.putAll(old);
            f.set(client, map);
        } catch (ReflectiveOperationException | RuntimeException e) {
            ReportAppsPlugin.log("Apps (beta): app tabs won't reopen from bookmarks", e);
        }
    }

    /** The client's module of this name (making an app module if need be), or null. */
    static AppModule find(String moduleName) {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return null;
        }
        try {
            Field f = Client.class.getDeclaredField("modules");
            f.setAccessible(true);
            Object map = f.get(client);
            Object m = map instanceof Map ? ((Map<?, ?>) map).get(moduleName) : null;
            return m instanceof AppModule ? (AppModule) m : null;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    /** True once the client knows this module (so addModule isn't repeated). */
    static boolean registered(AppModule m) {
        Client client = ReportAppsMenu.client();
        if (client == null) {
            return false;
        }
        try {
            Field f = Client.class.getDeclaredField("modules");
            f.setAccessible(true);
            Object map = f.get(client);
            return map instanceof Map && ((Map<?, ?>) map).get(m.getModuleName()) == m;
        } catch (ReflectiveOperationException | RuntimeException e) {
            return false;
        }
    }

    /** The client's module map, making app modules on first lookup. */
    static final class OnDemand extends HashMap<Object, Object> {
        private static final long serialVersionUID = 1L;

        @Override
        public Object get(Object key) {
            Object m = super.get(key);
            if (m == null && key instanceof String && ((String) key).startsWith(AppModule.PREFIX)
                && ((String) key).length() > AppModule.PREFIX.length()) {
                Client client = ReportAppsMenu.client();
                if (client != null) {
                    AppModule created = new AppModule(AppModule.appName((String) key), null);
                    client.addModule(created);   // puts it in this map
                    m = super.get(key);
                    if (m == null) {
                        put(key, created);
                        m = created;
                    }
                }
            }
            return m;
        }
    }
}
