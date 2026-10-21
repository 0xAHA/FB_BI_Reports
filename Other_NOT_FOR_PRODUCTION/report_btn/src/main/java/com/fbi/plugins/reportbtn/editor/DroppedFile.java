package com.fbi.plugins.reportbtn.editor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.awt.datatransfer.DataFlavor;
import java.awt.datatransfer.UnsupportedFlavorException;
import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import javax.swing.JComponent;
import javax.swing.TransferHandler;

/**
 * A file dropped on the code, as the BI Editor takes one: a page, script or style file's
 * text replaces the code. A Fishbowl export (the "<name>-<Type>.json" a Download or the
 * SharePoint folder holds) gives its code, name and description, but only on a tab of the
 * same kind (a Style export on a Style tab). Pure, apart from reading the file.
 */
final class DroppedFile {

    /** Larger files are refused: a BI record this size is not a page. */
    static final long MAX_BYTES = 8L * 1024 * 1024;

    /** The code, with the name and description when the file is an export. */
    final String text;
    final String name;
    final String description;
    /** Why the file can't be loaded; null when it can. */
    final String error;
    /** A question to confirm first (a .css file on a Script tab); null when there is none. */
    final String confirm;

    private DroppedFile(String text, String name, String description, String error, String confirm) {
        this.text = text;
        this.name = name;
        this.description = description;
        this.error = error;
        this.confirm = confirm;
    }

    static DroppedFile read(File f, int tabTypeId) {
        if (f == null || !f.isFile()) {
            return failed("Only a file can be dropped here.");
        }
        if (f.length() > MAX_BYTES) {
            return failed(f.getName() + " is too large to be a page, script or style.");
        }
        try {
            return parse(f.getName(), new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8), tabTypeId);
        } catch (IOException | RuntimeException e) {
            return failed("Couldn't read " + f.getName() + ": " + e.getMessage());
        }
    }

    static DroppedFile parse(String fileName, String content, int tabTypeId) {
        String file = fileName == null ? "the file" : fileName;
        String ext = ext(file);
        String body = content == null ? "" : content;
        if (!body.isEmpty() && body.charAt(0) == '﻿') {
            body = body.substring(1);
        }
        if (ext.matches("png|jpe?g|gif|bmp|ico|svg|webp|pdf|zip|jar|exe|docx?|xlsx?")) {
            return failed(file + " isn't a text file. Images are edited in the BI Editor module.");
        }
        if (ext.equals("json")) {
            return export(file, body, tabTypeId);
        }
        if (body.indexOf('\u0000') >= 0) {
            return failed(file + " isn't a text file.");
        }
        int fileType = typeOfExtension(ext);
        String ask = fileType != 0 && !sameKind(fileType, tabTypeId)
            ? file + " looks like " + article(kind(fileType)) + ", and this is " + article(kind(tabTypeId)) + ". Load it anyway?"
            : null;
        return new DroppedFile(body, null, null, null, ask);
    }

    /** A Fishbowl export: [ { name, description, data, active, note, type } ] (one record). */
    private static DroppedFile export(String file, String body, int tabTypeId) {
        JsonNode root;
        try {
            root = new ObjectMapper().readTree(body);
        } catch (IOException | RuntimeException e) {
            return failed(file + " isn't a Fishbowl export (" + e.getMessage() + ").");
        }
        JsonNode rec = root != null && root.isArray() ? (root.size() > 0 ? root.get(0) : null) : root;
        if (rec == null || !rec.isObject() || !rec.has("data")) {
            return failed(file + " isn't a Fishbowl export: it has no record with code (\"data\").");
        }
        if (root.isArray() && root.size() > 1) {
            return failed(file + " holds " + root.size() + " records. Use Import for it.");
        }
        int fileType = typeOfName(rec.path("type").asText(""));
        if (fileType == 50) {
            return failed(file + " is an image. Images are edited in the BI Editor module.");
        }
        if (fileType != 0 && !sameKind(fileType, tabTypeId)) {
            return failed(file + " holds " + article(kind(fileType)) + ", and this is " + article(kind(tabTypeId))
                + ". Drop it on " + article(kind(fileType)) + " tab, or use Import.");
        }
        String name = rec.hasNonNull("name") ? rec.get("name").asText().trim() : null;
        String description = rec.hasNonNull("description") ? rec.get("description").asText().trim() : null;
        return new DroppedFile(rec.get("data").asText(""), name, description, null, null);
    }

    private static DroppedFile failed(String why) {
        return new DroppedFile(null, null, null, why, null);
    }

    /** A page and a template are both HTML, so either loads into the other. */
    private static boolean sameKind(int a, int b) {
        return a == b || (isHtml(a) && isHtml(b));
    }

    private static boolean isHtml(int t) {
        return t == 10 || t == 40;
    }

    static int typeOfExtension(String ext) {
        switch (ext) {
            case "htm": case "html": return 10;
            case "js": return 20;
            case "css": return 30;
            default: return 0;
        }
    }

    static int typeOfName(String type) {
        switch (type.trim().toLowerCase(Locale.ROOT)) {
            case "page": return 10;
            case "script": return 20;
            case "style": return 30;
            case "template": return 40;
            case "image": return 50;
            default: return 0;
        }
    }

    private static String kind(int t) {
        switch (t) {
            case 20: return "script";
            case 30: return "style";
            case 40: return "template";
            case 50: return "image";
            default: return "app";
        }
    }

    private static String article(String noun) {
        return ("aeiou".indexOf(noun.charAt(0)) >= 0 ? "an " : "a ") + noun;
    }

    private static String ext(String file) {
        int dot = file.lastIndexOf('.');
        return dot < 0 ? "" : file.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    /** One file dropped on the App Library: its name and text (the page read it). */
    static final class Named {
        final String name;
        final String text;

        Named(String name, String text) {
            this.name = name;
            this.text = text;
        }

        String ext() {
            return DroppedFile.ext(name);
        }

        boolean isExport() {
            return "json".equals(ext());
        }

        /** The name without folders or characters Windows won't take, for a temp file. */
        String safeName() {
            String s = name.replaceAll(".*[\\\\/]", "").replaceAll("[<>:\"|?*\\x00-\\x1f]", "_").trim();
            return s.isEmpty() ? "dropped.json" : s;
        }
    }

    /** The files the App Library sends ([{"name", "text"}, ...]); only .htm, .html, .js, .css and .json are kept. */
    static List<Named> payload(String json) {
        List<Named> out = new java.util.ArrayList<>();
        try {
            JsonNode root = new ObjectMapper().readTree(json == null ? "" : json);
            if (root != null && root.isArray()) {
                for (JsonNode n : root) {
                    String name = n.path("name").asText("").trim();
                    if (!name.isEmpty() && n.has("text") && ext(name).matches("html?|js|css|json")) {
                        out.add(new Named(name, n.get("text").asText("")));
                    }
                }
            }
        } catch (IOException | RuntimeException ignored) {
            // nothing usable
        }
        return out;
    }

    /** A page's record name is its FB_REPORT.name when it has one; otherwise the file name without its extension. */
    static String recordName(String fileName, String text, int type) {
        if (type == 10 && text != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                .compile("window\\.FB_REPORT\\s*=\\s*\\{[^}]*?\\bname\\s*:\\s*(['\"])(.+?)\\1", java.util.regex.Pattern.DOTALL)
                .matcher(text);
            if (m.find() && !m.group(2).trim().isEmpty()) {
                return m.group(2).trim();
            }
        }
        String base = fileName == null ? "" : fileName.replaceAll(".*[\\\\/]", "");
        int dot = base.lastIndexOf('.');
        return (dot > 0 ? base.substring(0, dot) : base).trim();
    }

    /** A page's description meta content, or "". */
    static String metaDescription(String text) {
        if (text == null) {
            return "";
        }
        java.util.regex.Matcher m = java.util.regex.Pattern
            .compile("<meta\\s+name=\"description\"\\s+content=\"([^\"]*)\"", java.util.regex.Pattern.CASE_INSENSITIVE).matcher(text);
        return m.find() ? m.group(1).replace("&quot;", "\"").replace("&amp;", "&").trim() : "";
    }

    /**
     * The code area's own handler for text (typing, paste, dragging text), with files dropped
     * from Explorer handed to onFiles. A pasted file list is left to the text handler.
     */
    static final class Handler extends TransferHandler {
        private final TransferHandler text;
        private final Consumer<List<File>> onFiles;

        Handler(TransferHandler text, Consumer<List<File>> onFiles) {
            this.text = text;
            this.onFiles = onFiles;
        }

        private static boolean files(TransferSupport s) {
            return s.isDrop() && s.isDataFlavorSupported(DataFlavor.javaFileListFlavor);
        }

        @Override
        public boolean canImport(TransferSupport s) {
            if (files(s)) {
                if ((s.getSourceDropActions() & COPY) != 0) {
                    s.setDropAction(COPY);
                }
                s.setShowDropLocation(false);
                return true;
            }
            return text != null && text.canImport(s);
        }

        @Override
        public boolean importData(TransferSupport s) {
            if (files(s)) {
                try {
                    @SuppressWarnings("unchecked")
                    List<File> list = (List<File>) s.getTransferable().getTransferData(DataFlavor.javaFileListFlavor);
                    if (list != null && !list.isEmpty()) {
                        // After the drop completes: a dialog during it would hold Explorer's drag.
                        javax.swing.SwingUtilities.invokeLater(() -> onFiles.accept(list));
                        return true;
                    }
                } catch (UnsupportedFlavorException | IOException | RuntimeException ignored) {
                    // nothing to load
                }
                return false;
            }
            return text != null && text.importData(s);
        }

        @Override
        public int getSourceActions(JComponent c) {
            return text == null ? NONE : text.getSourceActions(c);
        }

        @Override
        public void exportAsDrag(JComponent comp, java.awt.event.InputEvent e, int action) {
            if (text != null) {
                text.exportAsDrag(comp, e, action);
            }
        }

        @Override
        public void exportToClipboard(JComponent comp, java.awt.datatransfer.Clipboard clip, int action) {
            if (text != null) {
                text.exportToClipboard(comp, clip, action);
            }
        }
    }
}
