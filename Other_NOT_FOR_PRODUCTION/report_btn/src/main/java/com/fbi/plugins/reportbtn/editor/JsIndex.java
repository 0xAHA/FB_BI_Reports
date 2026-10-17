package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The functions a shared JS module (fb-lib, fb-mfg, fb-doc, fb-pricing, ...) exports,
 * found from its source without running it. Three export styles are understood:
 *
 *   window.FBLib = (function () { ... return { Common, Settings, ... } })();
 *       each name resolved to its declaration in the innermost enclosing scope, so
 *       the same inner name in two sub-modules (init, attach, render) stays apart;
 *   global.FBMfg = { Finisher, Staging: { orderRowsByChain: psOrderMoRowsByChain } };
 *   var FBDoc = {}; FBDoc.page = ...; FBDoc.param = param; param.fromEl = function ...
 *       property assignments on a namespace (or on a function) become its members.
 *
 * Docs: the comments directly above a declaration or member, else an "API" line in
 * the file's comments (FBX.a.b(args) -> result), else nothing.
 */
final class JsIndex {

    enum Kind { NAMESPACE, FUNCTION, GETTER, VALUE }

    /** One exported name. */
    static final class Symbol {
        final String name;
        String path;
        Kind kind;
        String params = "";
        boolean async;
        String doc = "";
        int line;
        final Map<String, Symbol> children = new LinkedHashMap<>();

        Symbol(String name, Kind kind) {
            this.name = name;
            this.kind = kind;
        }

        /** FBLib.Common.formatMoney(value) for a function, else the path. */
        String signature() {
            return kind == Kind.FUNCTION ? path + "(" + params + ")" : path;
        }

        Symbol child(String path) {
            Symbol s = this;
            for (String part : path.split("\\.")) {
                s = s.children.get(part);
                if (s == null) {
                    return null;
                }
            }
            return s;
        }

        int count() {
            int c = 1;
            for (Symbol s : children.values()) {
                c += s.count();
            }
            return c;
        }
    }

    /** A module's exports, under its global (FBLib, FBMfg, ...). */
    static final class Module {
        final String scriptName;
        final List<Symbol> roots = new ArrayList<>();
        String summary = "";
        /** Why nothing was indexed (too big, minified, no global found), or "". */
        String note = "";

        Module(String scriptName) {
            this.scriptName = scriptName;
        }

        Symbol find(String path) {
            int dot = path.indexOf('.');
            String root = dot < 0 ? path : path.substring(0, dot);
            for (Symbol r : roots) {
                if (r.name.equals(root)) {
                    return dot < 0 ? r : r.child(path.substring(dot + 1));
                }
            }
            return null;
        }

        /** Every symbol, depth first (roots included). */
        List<Symbol> all() {
            List<Symbol> out = new ArrayList<>();
            Deque<Symbol> stack = new ArrayDeque<>();
            for (int i = roots.size() - 1; i >= 0; i--) {
                stack.push(roots.get(i));
            }
            while (!stack.isEmpty()) {
                Symbol s = stack.pop();
                out.add(s);
                List<Symbol> kids = new ArrayList<>(s.children.values());
                for (int i = kids.size() - 1; i >= 0; i--) {
                    stack.push(kids.get(i));
                }
            }
            return out;
        }
    }

    private static final int MAX_BYTES = 600_000;
    private static final int MAX_DEPTH = 8;
    private static final Set<String> GLOBALS = new HashSet<>(Arrays.asList("window", "global", "globalThis", "self"));
    private static final Set<String> NOT_A_METHOD = new HashSet<>(Arrays.asList(
        "if", "for", "while", "switch", "catch", "function", "with", "return", "typeof", "new"));
    private static final Pattern API_LINE = Pattern.compile(
        "\\b(FB[A-Za-z0-9_$]*(?:\\.[A-Za-z_$][A-Za-z0-9_$]*)+)\\s*(?:\\(([^()]*)\\))?\\s*(?:->|→)\\s*(.+)$");

    // ---------------------------------------------------------------- state
    private final String src;
    private final List<JsLexer.Token> all;      // with comments
    private final JsLexer.Token[] t;            // significant tokens only
    private final int[] fullIndex;              // t[i] -> its index in all
    private final int[] match;                  // bracket partner, or -1
    private final List<int[]> bodies = new ArrayList<>();   // {open, close} of function bodies
    private final int[] bodyOf;                 // innermost body (index into bodies) per token, or -1
    private final Map<String, List<Decl>> decls = new HashMap<>();
    private final List<Assign> assigns = new ArrayList<>();
    private final Map<String, String[]> apiLines = new HashMap<>();
    private final Set<Decl> active = new HashSet<>();

    private static final class Decl {
        final boolean function;
        final int nameIdx;
        final int at;       // the 'function' (or 'async') keyword, or the token after '='
        final int scope;    // body index, or -1 for the file

        Decl(boolean function, int nameIdx, int at, int scope) {
            this.function = function;
            this.nameIdx = nameIdx;
            this.at = at;
            this.scope = scope;
        }
    }

    private static final class Assign {
        final String base;
        final List<String> path;
        final int baseIdx;
        final int exprIdx;

        Assign(String base, List<String> path, int baseIdx, int exprIdx) {
            this.base = base;
            this.path = path;
            this.baseIdx = baseIdx;
            this.exprIdx = exprIdx;
        }
    }

    private JsIndex(String src) {
        this.src = src;
        this.all = JsLexer.tokenize(src);
        List<JsLexer.Token> sig = new ArrayList<>();
        List<Integer> map = new ArrayList<>();
        for (int i = 0; i < all.size(); i++) {
            if (!all.get(i).isComment()) {
                sig.add(all.get(i));
                map.add(i);
            }
        }
        this.t = sig.toArray(new JsLexer.Token[0]);
        this.fullIndex = new int[t.length];
        for (int i = 0; i < t.length; i++) {
            fullIndex[i] = map.get(i);
        }
        this.match = matchBrackets();
        findBodies();
        this.bodyOf = mapBodies();
        findDeclarations();
        findAssignments();
        findApiLines();
    }

    /** Indexes one module's source. Never throws on odd code: what can't be read is left out. */
    static Module index(String scriptName, String source) {
        Module m = new Module(scriptName);
        if (source == null || source.isEmpty()) {
            m.note = "empty";
            return m;
        }
        if (source.length() > MAX_BYTES) {
            m.note = "too large to index (" + source.length() / 1024 + " KB)";
            return m;
        }
        int lines = 1;
        for (int i = 0; i < source.length(); i++) {
            if (source.charAt(i) == '\n') {
                lines++;
            }
        }
        if (source.length() / lines > 500) {
            m.note = "minified: not indexed";
            return m;
        }
        JsIndex ix = new JsIndex(source);
        m.summary = ix.headerComment();
        ix.findRoots(m);
        if (m.roots.isEmpty()) {
            m.note = "no global namespace (window.X = ...) found";
        }
        return m;
    }

    // ---------------------------------------------------------------- structure
    private int[] matchBrackets() {
        int[] m = new int[t.length];
        Arrays.fill(m, -1);
        Deque<Integer> stack = new ArrayDeque<>();
        for (int i = 0; i < t.length; i++) {
            if (t[i].type != JsLexer.Type.PUNCT) {
                continue;
            }
            String p = t[i].text;
            if (p.equals("(") || p.equals("[") || p.equals("{")) {
                stack.push(i);
            } else if (p.equals(")") || p.equals("]") || p.equals("}")) {
                if (!stack.isEmpty()) {
                    int o = stack.pop();
                    m[o] = i;
                    m[i] = o;
                }
            }
        }
        return m;
    }

    private void findBodies() {
        for (int i = 0; i < t.length; i++) {
            int open = -1;
            if (t[i].is("function")) {
                int p = i + 1;
                if (p < t.length && t[p].is("*")) {
                    p++;
                }
                if (p < t.length && t[p].type == JsLexer.Type.IDENT) {
                    p++;
                }
                if (p < t.length && t[p].is("(") && match[p] > 0) {
                    open = match[p] + 1;
                }
            } else if (t[i].is("=>")) {
                open = i + 1;
            } else if (t[i].type == JsLexer.Type.IDENT && !NOT_A_METHOD.contains(t[i].text)
                && i + 1 < t.length && t[i + 1].is("(") && match[i + 1] > 0
                && match[i + 1] + 1 < t.length && t[match[i + 1] + 1].is("{")
                && (i == 0 || !t[i - 1].is("function"))) {
                open = match[i + 1] + 1;   // method shorthand: name(args) { ... }
            }
            if (open > 0 && open < t.length && t[open].is("{") && match[open] > open) {
                bodies.add(new int[]{open, match[open]});
            }
        }
        bodies.sort((a, b) -> Integer.compare(a[0], b[0]));
    }

    private int[] mapBodies() {
        int[] of = new int[t.length];
        Deque<Integer> stack = new ArrayDeque<>();
        int next = 0;
        for (int i = 0; i < t.length; i++) {
            while (!stack.isEmpty() && bodies.get(stack.peek())[1] < i) {
                stack.pop();
            }
            while (next < bodies.size() && bodies.get(next)[0] == i) {
                stack.push(next++);
            }
            // The body's own braces belong to the enclosing scope.
            int inner = -1;
            for (Integer b : stack) {
                int[] r = bodies.get(b);
                if (r[0] < i && i < r[1]) {
                    inner = b;
                    break;   // the stack iterates from the most recently opened
                }
            }
            of[i] = inner;
        }
        return of;
    }

    private void findDeclarations() {
        for (int i = 0; i < t.length; i++) {
            JsLexer.Token tok = t[i];
            if (tok.is("function") && i + 1 < t.length && t[i + 1].type == JsLexer.Type.IDENT && !isExpressionPosition(i)) {
                int at = i > 0 && t[i - 1].is("async") ? i - 1 : i;
                addDecl(t[i + 1].text, new Decl(true, i + 1, at, bodyOf[i]));
            } else if ((tok.is("var") || tok.is("let") || tok.is("const")) && i + 2 < t.length
                && t[i + 1].type == JsLexer.Type.IDENT && t[i + 2].is("=")) {
                addDecl(t[i + 1].text, new Decl(false, i + 1, i + 3, bodyOf[i]));
            }
        }
    }

    private boolean isExpressionPosition(int fnIdx) {
        int p = fnIdx - 1;
        if (p >= 0 && t[p].is("async")) {
            p--;
        }
        if (p < 0) {
            return false;
        }
        String s = t[p].text;
        return t[p].type == JsLexer.Type.PUNCT && (s.equals("=") || s.equals(":") || s.equals("(") || s.equals(",")
            || s.equals("?") || s.equals("||") || s.equals("&&") || s.equals("??") || s.equals("["))
            || t[p].is("return");
    }

    private void addDecl(String name, Decl d) {
        decls.computeIfAbsent(name, k -> new ArrayList<>()).add(d);
    }

    // Statements like  A.b.c = expr  (not A.b == c, not x.A.b = ...).
    private void findAssignments() {
        for (int i = 0; i + 3 < t.length; i++) {
            if (t[i].type != JsLexer.Type.IDENT || (i > 0 && (t[i - 1].is(".") || t[i - 1].is("?.")))) {
                continue;
            }
            List<String> path = new ArrayList<>();
            int j = i + 1;
            while (j + 1 < t.length && t[j].is(".") && t[j + 1].type == JsLexer.Type.IDENT) {
                path.add(t[j + 1].text);
                j += 2;
            }
            if (!path.isEmpty() && j < t.length && t[j].is("=") && j + 1 < t.length) {
                assigns.add(new Assign(t[i].text, path, i, j + 1));
            }
        }
    }

    private void findApiLines() {
        for (JsLexer.Token c : all) {
            if (!c.isComment()) {
                continue;
            }
            for (String raw : c.text.split("\n")) {
                String line = raw.replaceFirst("^\\s*(//+|/\\*+|\\*+)?\\s*", "").replaceFirst("\\*/\\s*$", "").trim();
                Matcher m = API_LINE.matcher(line);
                if (m.find() && !apiLines.containsKey(m.group(1))) {
                    apiLines.put(m.group(1), new String[]{m.group(2), m.group(3).trim()});
                }
            }
        }
    }

    // ---------------------------------------------------------------- roots
    private void findRoots(Module m) {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i + 3 < t.length; i++) {
            if (t[i].type == JsLexer.Type.IDENT && GLOBALS.contains(t[i].text) && (i == 0 || !t[i - 1].is("."))
                && t[i + 1].is(".") && t[i + 2].type == JsLexer.Type.IDENT && t[i + 3].is("=")
                && i + 4 < t.length) {
                String name = t[i + 2].text;
                if (!Character.isUpperCase(name.charAt(0)) || !seen.add(name)) {
                    continue;
                }
                Symbol root = eval(i + 4, 0, name);
                root.path = name;
                if (root.doc.isEmpty()) {
                    root.doc = doc(i);
                }
                if (root.line == 0) {
                    root.line = t[i].line;
                }
                if (root.kind == Kind.VALUE && root.children.isEmpty()) {
                    continue;   // e.g. window.FB_REPORT = ... data, not a module
                }
                assignPaths(root, name);
                fillFromApi(root);
                m.roots.add(root);
            }
        }
    }

    private void assignPaths(Symbol s, String path) {
        s.path = path;
        for (Symbol c : s.children.values()) {
            assignPaths(c, path + "." + c.name);
        }
    }

    private void fillFromApi(Symbol s) {
        String[] api = apiLines.get(s.path);
        if (api != null) {
            if (s.doc.isEmpty()) {
                s.doc = "→ " + api[1];
            }
            if (s.kind == Kind.FUNCTION && s.params.isEmpty() && api[0] != null) {
                s.params = cleanParams(api[0]);
            }
        }
        for (Symbol c : s.children.values()) {
            fillFromApi(c);
        }
    }

    // ---------------------------------------------------------------- evaluation
    /** What the expression starting at token i is, as a symbol called name. */
    private Symbol eval(int i, int depth, String name) {
        Symbol s = new Symbol(name, Kind.VALUE);
        if (i >= t.length || depth > MAX_DEPTH) {
            return s;
        }
        s.line = t[i].line;
        boolean async = t[i].is("async");
        int k = async ? i + 1 : i;
        if (k >= t.length) {
            return s;
        }
        // function (...) { }   async function (...) { }
        if (t[k].is("function")) {
            return function(s, k, async);
        }
        // (args) => ...   x => ...
        if (t[k].is("(") && match[k] > 0 && match[k] + 1 < t.length && t[match[k] + 1].is("=>")) {
            s.kind = Kind.FUNCTION;
            s.async = async;
            s.params = paramsBetween(k, match[k]);
            return s;
        }
        if (t[k].type == JsLexer.Type.IDENT && k + 1 < t.length && t[k + 1].is("=>")) {
            s.kind = Kind.FUNCTION;
            s.async = async;
            s.params = t[k].text;
            return s;
        }
        // ( ... ): an IIFE, or just parentheses
        if (t[k].is("(") && match[k] > 0) {
            Symbol iife = iife(k, depth, name);
            if (iife != null) {
                return iife;
            }
            return eval(k + 1, depth + 1, name);
        }
        if (t[k].is("{") && match[k] > 0) {
            s.kind = Kind.NAMESPACE;
            object(s, k, depth);
            return s;
        }
        if (t[k].type == JsLexer.Type.IDENT) {
            boolean member = k + 1 < t.length && (t[k + 1].is(".") || t[k + 1].is("?."));
            boolean call = k + 1 < t.length && t[k + 1].is("(");
            if (!member && !call) {
                return identifier(t[k].text, k, depth, name, s);
            }
        }
        return s;   // a literal, a call, a member expression: a value
    }

    private Symbol function(Symbol s, int fnIdx, boolean async) {
        s.kind = Kind.FUNCTION;
        s.async = async;
        int p = fnIdx + 1;
        if (p < t.length && t[p].is("*")) {
            p++;
        }
        if (p < t.length && t[p].type == JsLexer.Type.IDENT) {
            p++;
        }
        if (p < t.length && t[p].is("(") && match[p] > 0) {
            s.params = paramsBetween(p, match[p]);
        }
        return s;
    }

    /** (function () { ... })() and its variants: the object the function returns. */
    private Symbol iife(int paren, int depth, String name) {
        int f = paren + 1;
        boolean async = f < t.length && t[f].is("async");
        if (async) {
            f++;
        }
        if (f >= t.length) {
            return null;
        }
        int bodyOpen;
        if (t[f].is("function")) {
            int p = f + 1;
            if (p < t.length && t[p].type == JsLexer.Type.IDENT) {
                p++;
            }
            if (p >= t.length || !t[p].is("(") || match[p] < 0) {
                return null;
            }
            bodyOpen = match[p] + 1;
        } else if (t[f].is("(") && match[f] > 0 && match[f] + 2 < t.length && t[match[f] + 1].is("=>")) {
            bodyOpen = match[f] + 2;
        } else {
            return null;
        }
        if (bodyOpen >= t.length || !t[bodyOpen].is("{") || match[bodyOpen] < 0) {
            return null;
        }
        int bodyClose = match[bodyOpen];
        int after = bodyClose + 1;
        boolean called = after + 1 < t.length
            && ((t[after].is(")") && t[after + 1].is("(")) || (t[after].is("(") && match[after] > 0
                && match[after] + 1 < t.length && t[match[after] + 1].is(")")));
        if (!called) {
            return null;
        }
        int body = bodyIndex(bodyOpen);
        Symbol s = new Symbol(name, Kind.NAMESPACE);
        s.line = t[paren].line;
        for (int r = bodyClose - 1; r > bodyOpen; r--) {
            if (t[r].is("return") && bodyOf[r] == body && r + 1 < bodyClose) {
                Symbol ret = eval(r + 1, depth + 1, name);
                ret.line = t[paren].line;   // a module is where its IIFE starts, not where it returns
                return ret;
            }
        }
        return s;   // returns nothing: its globals are found as roots
    }

    private int bodyIndex(int open) {
        for (int b = 0; b < bodies.size(); b++) {
            if (bodies.get(b)[0] == open) {
                return b;
            }
        }
        return -2;
    }

    /** { a, b: c, get d() {}, e(x) {}, 'f': g, ...h } */
    private void object(Symbol s, int open, int depth) {
        int close = match[open];
        int a = open + 1;
        while (a < close) {
            int b = a;
            while (b < close && !t[b].is(",")) {
                b = match[b] > b ? match[b] + 1 : b + 1;
            }
            member(s, a, b, depth);
            a = b + 1;
        }
    }

    private void member(Symbol parent, int a, int b, int depth) {
        if (a >= b || t[a].is("...") || t[a].is("[")) {
            return;
        }
        String keyDoc = doc(a);
        JsLexer.Token k0 = t[a];
        // get name() { }  /  set name(v) { }
        if ((k0.is("get") || k0.is("set")) && a + 2 < b && t[a + 1].type == JsLexer.Type.IDENT && t[a + 2].is("(")) {
            if (k0.is("get")) {
                Symbol g = new Symbol(t[a + 1].text, Kind.GETTER);
                g.line = k0.line;
                g.doc = keyDoc;
                parent.children.put(g.name, g);
            }
            return;
        }
        // async name(args) { }   name(args) { }
        int m = k0.is("async") && a + 1 < b ? a + 1 : a;
        if (t[m].type == JsLexer.Type.IDENT && m + 1 < b && t[m + 1].is("(") && match[m + 1] > 0) {
            Symbol f = new Symbol(t[m].text, Kind.FUNCTION);
            f.async = m != a;
            f.params = paramsBetween(m + 1, match[m + 1]);
            f.line = t[m].line;
            f.doc = keyDoc;
            parent.children.put(f.name, f);
            return;
        }
        String key = keyName(k0);
        if (key == null) {
            return;
        }
        Symbol v;
        if (a + 1 < b && t[a + 1].is(":")) {
            v = eval(a + 2, depth + 1, key);
        } else if (a + 1 == b && k0.type == JsLexer.Type.IDENT) {
            v = identifier(k0.text, a, depth + 1, key, new Symbol(key, Kind.VALUE));
        } else {
            return;
        }
        if (!keyDoc.isEmpty()) {
            v.doc = keyDoc;
        }
        if (v.line == 0) {
            v.line = k0.line;
        }
        parent.children.put(key, v);
    }

    private static String keyName(JsLexer.Token k) {
        if (k.type == JsLexer.Type.IDENT || k.type == JsLexer.Type.NUMBER) {
            return k.text;
        }
        if (k.type == JsLexer.Type.STRING && k.text.length() >= 2) {
            String s = k.text.substring(1, k.text.length() - 1);
            return s.matches("[A-Za-z_$][A-Za-z0-9_$]*") ? s : null;
        }
        return null;
    }

    /** A name, resolved to its declaration in the innermost scope that sees it. */
    private Symbol identifier(String id, int at, int depth, String name, Symbol fallback) {
        Decl d = resolve(id, at);
        if (d == null || active.contains(d) || depth > MAX_DEPTH) {
            return fallback;
        }
        active.add(d);
        try {
            Symbol s;
            if (d.function) {
                s = new Symbol(name, Kind.FUNCTION);
                int fn = t[d.at].is("async") ? d.at + 1 : d.at;
                function(s, fn, t[d.at].is("async"));
                s.line = t[d.nameIdx].line;
                s.doc = doc(d.at);
            } else {
                s = eval(d.at, depth + 1, name);
                if (s.doc.isEmpty()) {
                    s.doc = doc(d.nameIdx - 1);
                }
                if (s.line == 0) {
                    s.line = t[d.nameIdx].line;
                }
            }
            // Properties set on it later: FBDoc.page = ...; param.fromEl = function ...
            for (Assign as : assigns) {
                if (as.base.equals(id) && resolve(id, as.baseIdx) == d) {
                    attach(s, as, depth);
                }
            }
            return s;
        } finally {
            active.remove(d);
        }
    }

    private void attach(Symbol s, Assign as, int depth) {
        if (s.kind == Kind.VALUE) {
            s.kind = Kind.NAMESPACE;
        }
        Symbol node = s;
        for (int i = 0; i < as.path.size() - 1; i++) {
            String part = as.path.get(i);
            node = node.children.computeIfAbsent(part, k -> new Symbol(k, Kind.NAMESPACE));
        }
        String leaf = as.path.get(as.path.size() - 1);
        if (node.children.containsKey(leaf)) {
            return;   // the first assignment wins (later ones are usually re-assignments)
        }
        Symbol v = eval(as.exprIdx, depth + 1, leaf);
        String d = doc(as.baseIdx);
        if (!d.isEmpty()) {
            v.doc = d;
        }
        if (v.line == 0) {
            v.line = t[as.baseIdx].line;
        }
        node.children.put(leaf, v);
    }

    private Decl resolve(String id, int at) {
        List<Decl> list = decls.get(id);
        if (list == null) {
            return null;
        }
        Decl best = null;
        int bestOpen = -1;
        for (Decl d : list) {
            int open = d.scope < 0 ? 0 : bodies.get(d.scope)[0];
            boolean visible = d.scope < 0 || (bodies.get(d.scope)[0] < at && at < bodies.get(d.scope)[1]);
            if (!visible) {
                continue;
            }
            if (best == null || open > bestOpen || (open == bestOpen && d.nameIdx <= at)) {
                best = d;
                bestOpen = open;
            }
        }
        return best;
    }

    // ---------------------------------------------------------------- params & docs
    private String paramsBetween(int open, int close) {
        return cleanParams(src.substring(t[open].end, t[close].start));
    }

    /** "a, b = 2, { x, y } = {}" -> "a, b, {x, y}"; long destructuring becomes {…}. */
    static String cleanParams(String raw) {
        if (raw == null) {
            return "";
        }
        String s = raw.replaceAll("/\\*.*?\\*/", "").replaceAll("//[^\n]*", "").replaceAll("\\s+", " ").trim();
        List<String> parts = new ArrayList<>();
        int depth = 0, start = 0;
        for (int i = 0; i <= s.length(); i++) {
            char c = i < s.length() ? s.charAt(i) : ',';
            if (c == '(' || c == '[' || c == '{') {
                depth++;
            } else if (c == ')' || c == ']' || c == '}') {
                depth--;
            } else if (c == ',' && depth == 0) {
                String p = s.substring(start, Math.min(i, s.length())).trim();
                start = i + 1;
                if (p.isEmpty()) {
                    continue;
                }
                int eq = topLevelEquals(p);
                if (eq > 0) {
                    p = p.substring(0, eq).trim();
                }
                if (p.startsWith("{") || p.startsWith("[")) {
                    String compact = p.replaceAll("\\s+", " ").replaceAll("\\s*([{}\\[\\],])\\s*", "$1").replace(",", ", ");
                    p = compact.length() > 28 ? (p.startsWith("{") ? "{…}" : "[…]") : compact;
                }
                parts.add(p);
            }
        }
        return String.join(", ", parts);
    }

    private static int topLevelEquals(String p) {
        int depth = 0;
        for (int i = 0; i < p.length(); i++) {
            char c = p.charAt(i);
            if (c == '(' || c == '[' || c == '{') {
                depth++;
            } else if (c == ')' || c == ']' || c == '}') {
                depth--;
            } else if (c == '=' && depth == 0 && (i + 1 >= p.length() || p.charAt(i + 1) != '>')) {
                return i;
            }
        }
        return -1;
    }

    /** The comments directly above significant token i, cleaned; "" if none. */
    private String doc(int i) {
        if (i < 0 || i >= t.length) {
            return "";
        }
        int f = fullIndex[i] - 1;
        List<String> parts = new ArrayList<>();
        int lineBelow = t[i].line;
        while (f >= 0 && all.get(f).isComment()) {
            JsLexer.Token c = all.get(f);
            int endLine = c.line + (int) c.text.chars().filter(ch -> ch == '\n').count();
            if (lineBelow - endLine > 2) {
                break;   // a gap: that comment belongs to something else
            }
            parts.add(0, cleanComment(c));
            lineBelow = c.line;
            f--;
            if (c.type != JsLexer.Type.LINE_COMMENT && c.text.startsWith("/**") && !c.text.startsWith("/***")) {
                break;   // a JSDoc block is the whole doc: comments above it belong to something else
            }
        }
        String text = String.join("\n", parts).trim();
        return text.length() > 4000 ? text.substring(0, 3999) + "…" : text;
    }

    private static String cleanComment(JsLexer.Token c) {
        StringBuilder out = new StringBuilder();
        String body = c.type == JsLexer.Type.LINE_COMMENT
            ? c.text.replaceFirst("^//+", "")
            : c.text.replaceFirst("^/\\*+", "").replaceFirst("\\*+/$", "");
        for (String line : body.split("\n")) {
            String l = line.replaceFirst("^\\s*\\*(?!/)\\s?", "").replaceAll("\\s+$", "");
            if (l.trim().matches("[=\\-*#_~]{3,}.*") && l.trim().replaceAll("[=\\-*#_~ ]", "").length() < 3) {
                continue;   // a banner rule
            }
            // Block comments keep their indentation (JSDoc @example code); line comments are trimmed.
            String kept = c.type == JsLexer.Type.LINE_COMMENT ? l.trim() : l.replaceAll("\\s+$", "");
            out.append(l.trim().isEmpty() ? "" : kept).append('\n');
        }
        return out.toString().replaceAll("\n{3,}", "\n\n").trim();
    }

    /** The file's opening comment block: its summary. */
    private String headerComment() {
        StringBuilder b = new StringBuilder();
        for (JsLexer.Token tok : all) {
            if (!tok.isComment()) {
                break;
            }
            b.append(cleanComment(tok)).append('\n');
        }
        String s = b.toString().trim();
        return s.length() > 1200 ? s.substring(0, 1199) + "…" : s;
    }

    /** Lower-cased, for search. */
    static String key(Symbol s) {
        return (s.path + " " + s.doc).toLowerCase(Locale.ROOT);
    }
}
