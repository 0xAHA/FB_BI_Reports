package com.fbi.plugins.reportbtn.editor;

import com.fbi.plugins.reportbtn.WorkspaceHost;

import javax.swing.SwingUtilities;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Module indexes, built in the background and kept per script id and save time,
 * so a script is read and parsed once until it is saved again. The source is the
 * copy saved in Fishbowl (what pages actually include), not the repo's.
 */
final class IndexCache {

    private final WorkspaceHost host;
    private final Map<String, JsIndex.Module> cache = new ConcurrentHashMap<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "report_btn-index");
        t.setDaemon(true);
        return t;
    });

    IndexCache(WorkspaceHost host) {
        this.host = host;
    }

    /** The index for a script, from the cache or built in the background; done runs on the event thread. */
    void get(ScriptService.Includable script, Consumer<JsIndex.Module> done) {
        String key = script.id + "@" + script.modified;
        JsIndex.Module hit = cache.get(key);
        if (hit != null) {
            done.accept(hit);
            return;
        }
        worker.submit(() -> {
            JsIndex.Module m;
            try {
                // runQuery works off the event thread (the Apps menu's tag scan does the same).
                List<?> rows = host.query("SELECT data FROM biscript WHERE id = " + script.id);
                String data = rows == null || rows.isEmpty() ? "" : host.column(rows.get(0), "data");
                m = JsIndex.index(script.name, data);
            } catch (RuntimeException | StackOverflowError e) {
                host.log("Page editor: indexing " + script.name + " failed", e instanceof RuntimeException ? e : null);
                m = new JsIndex.Module(script.name);
                m.note = "could not be indexed: " + e;
            }
            cache.put(key, m);
            JsIndex.Module result = m;
            SwingUtilities.invokeLater(() -> done.accept(result));
        });
    }

    void shutdown() {
        worker.shutdownNow();
    }
}
