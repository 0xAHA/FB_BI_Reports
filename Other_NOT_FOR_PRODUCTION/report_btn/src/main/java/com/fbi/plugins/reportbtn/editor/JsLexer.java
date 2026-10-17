package com.fbi.plugins.reportbtn.editor;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Just enough of a JavaScript tokenizer to find what a module exports. It skips
 * comments, strings, template literals (with ${ } code nested to any depth) and
 * regex literals, so the braces inside them (SQL in templates, /[{}]/g) never
 * reach the bracket matching. Comments are kept as tokens: the docs come from them.
 *
 * A "/" starts a regex after an operator, an opening bracket, a comma, or a keyword
 * such as return; anywhere else it divides. A regex that reaches the end of its
 * line was a division after all, so a wrong guess stays local.
 */
final class JsLexer {

    enum Type { IDENT, NUMBER, STRING, TEMPLATE, REGEX, PUNCT, LINE_COMMENT, BLOCK_COMMENT }

    static final class Token {
        final Type type;
        final int start;
        final int end;
        final int line;
        final String text;

        Token(Type type, int start, int end, int line, String text) {
            this.type = type;
            this.start = start;
            this.end = end;
            this.line = line;
            this.text = text;
        }

        boolean is(String s) {
            return (type == Type.PUNCT || type == Type.IDENT) && text.equals(s);
        }

        boolean isComment() {
            return type == Type.LINE_COMMENT || type == Type.BLOCK_COMMENT;
        }

        @Override
        public String toString() {
            return type + "@" + line + ":" + text;
        }
    }

    private static final Set<String> REGEX_AFTER_WORD = new HashSet<>(Arrays.asList(
        "return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void",
        "throw", "instanceof", "yield", "await"));

    // Longest first, so "===" wins over "==" and "=".
    private static final String[] PUNCTUATORS = {
        ">>>=", "...", "===", "!==", "**=", "<<=", ">>=", ">>>", "&&=", "||=", "??=",
        "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "++", "--", "+=", "-=", "*=",
        "/=", "%=", "&=", "|=", "^=", "<<", ">>", "**"};

    private final String src;
    private final int n;
    private int pos;
    private int line = 1;
    private final List<Token> out = new ArrayList<>();
    private Token lastSignificant;

    private JsLexer(String src) {
        this.src = src;
        this.n = src.length();
    }

    /** Every token, comments included, in source order. */
    static List<Token> tokenize(String source) {
        JsLexer lexer = new JsLexer(source == null ? "" : source);
        lexer.run(-1);
        return lexer.out;
    }

    /**
     * Lexes until the end, or (closeDepth >= 0) until the "}" that closes a template's
     * ${ at that brace depth, which is consumed but not emitted.
     */
    private void run(int closeDepth) {
        int depth = 0;
        while (pos < n) {
            char c = src.charAt(pos);
            if (c == '\n') {
                line++;
                pos++;
                continue;
            }
            if (Character.isWhitespace(c)) {
                pos++;
                continue;
            }
            int start = pos, startLine = line;
            if (c == '/' && peek(1) == '/') {
                int e = src.indexOf('\n', pos);
                pos = e < 0 ? n : e;
                add(Type.LINE_COMMENT, start, startLine);
                continue;
            }
            if (c == '/' && peek(1) == '*') {
                int e = src.indexOf("*/", pos + 2);
                pos = e < 0 ? n : e + 2;
                countLines(start, pos);
                add(Type.BLOCK_COMMENT, start, startLine);
                continue;
            }
            if (c == '\'' || c == '"') {
                skipString(c);
                add(Type.STRING, start, startLine);
                continue;
            }
            if (c == '`') {
                skipTemplate();
                add(Type.TEMPLATE, start, startLine);
                continue;
            }
            if (isIdentStart(c)) {
                pos++;
                while (pos < n && isIdentPart(src.charAt(pos))) {
                    pos++;
                }
                add(Type.IDENT, start, startLine);
                continue;
            }
            if (Character.isDigit(c) || (c == '.' && Character.isDigit(peek(1)))) {
                pos++;
                while (pos < n && (Character.isLetterOrDigit(src.charAt(pos)) || src.charAt(pos) == '.' || src.charAt(pos) == '_')) {
                    pos++;
                }
                add(Type.NUMBER, start, startLine);
                continue;
            }
            if (c == '/' && regexAllowed()) {
                if (skipRegex()) {
                    add(Type.REGEX, start, startLine);
                    continue;
                }
                pos = start;   // reached the end of the line: it was a division
            }
            if (c == '{') {
                depth++;
            } else if (c == '}') {
                if (closeDepth >= 0 && depth == closeDepth) {
                    pos++;
                    return;   // the end of a template's ${ ... }
                }
                depth--;
            }
            String p = punctuator();
            pos += p.length();
            add(Type.PUNCT, start, startLine);
        }
    }

    private String punctuator() {
        for (String p : PUNCTUATORS) {
            if (src.startsWith(p, pos)) {
                return p;
            }
        }
        return String.valueOf(src.charAt(pos));
    }

    private boolean regexAllowed() {
        Token t = lastSignificant;
        if (t == null) {
            return true;
        }
        switch (t.type) {
            case NUMBER:
            case STRING:
            case TEMPLATE:
            case REGEX:
                return false;
            case IDENT:
                return REGEX_AFTER_WORD.contains(t.text);
            case PUNCT:
                return !(t.text.equals(")") || t.text.equals("]") || t.text.equals("}")
                    || t.text.equals("++") || t.text.equals("--"));
            default:
                return true;
        }
    }

    /** Past a regex literal and its flags; false (position unchanged by the caller) if the line ends first. */
    private boolean skipRegex() {
        int i = pos + 1;
        boolean inClass = false;
        while (i < n) {
            char c = src.charAt(i);
            if (c == '\n' || c == '\r') {
                return false;
            }
            if (c == '\\') {
                i += 2;
                continue;
            }
            if (inClass) {
                if (c == ']') {
                    inClass = false;
                }
            } else if (c == '[') {
                inClass = true;
            } else if (c == '/') {
                i++;
                while (i < n && Character.isLetter(src.charAt(i))) {
                    i++;
                }
                pos = i;
                return true;
            }
            i++;
        }
        return false;
    }

    private void skipString(char quote) {
        pos++;
        while (pos < n) {
            char c = src.charAt(pos);
            if (c == '\\') {
                if (peek(1) == '\n') {
                    line++;
                }
                pos += 2;
                continue;
            }
            if (c == quote) {
                pos++;
                return;
            }
            if (c == '\n') {
                return;   // unterminated: stop at the line end
            }
            pos++;
        }
    }

    private void skipTemplate() {
        pos++;
        while (pos < n) {
            char c = src.charAt(pos);
            if (c == '\\') {
                pos += 2;
                continue;
            }
            if (c == '\n') {
                line++;
            }
            if (c == '`') {
                pos++;
                return;
            }
            if (c == '$' && peek(1) == '{') {
                pos += 2;
                // The ${ } code is lexed (and discarded) so its strings, braces and
                // nested templates are skipped correctly.
                JsLexer inner = new JsLexer(src);
                inner.pos = pos;
                inner.line = line;
                inner.run(0);
                pos = inner.pos;
                line = inner.line;
                continue;
            }
            pos++;
        }
    }

    private void countLines(int from, int to) {
        for (int i = from; i < to && i < n; i++) {
            if (src.charAt(i) == '\n') {
                line++;
            }
        }
    }

    private void add(Type type, int start, int startLine) {
        Token t = new Token(type, start, pos, startLine, src.substring(start, Math.min(pos, n)));
        out.add(t);
        if (!t.isComment()) {
            lastSignificant = t;
        }
    }

    private char peek(int ahead) {
        int i = pos + ahead;
        return i < n ? src.charAt(i) : '\0';
    }

    static boolean isIdentStart(char c) {
        return Character.isLetter(c) || c == '_' || c == '$';
    }

    static boolean isIdentPart(char c) {
        return Character.isLetterOrDigit(c) || c == '_' || c == '$';
    }
}
