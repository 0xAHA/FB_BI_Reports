package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.QueryParamTypeConst;
import org.fife.ui.rsyntaxtextarea.RSyntaxDocument;
import org.fife.ui.rsyntaxtextarea.parser.AbstractParser;
import org.fife.ui.rsyntaxtextarea.parser.DefaultParseResult;
import org.fife.ui.rsyntaxtextarea.parser.DefaultParserNotice;
import org.fife.ui.rsyntaxtextarea.parser.ParseResult;
import org.fife.ui.rsyntaxtextarea.parser.ParserNotice;

import javax.swing.text.BadLocationException;
import javax.swing.text.Element;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Warnings in the code's margin for Fishbowl's substitution rules: a directive or
 * setting token written more than once (Fishbowl substitutes every copy, even in
 * comments and strings), and an include that names no active record.
 */
final class DirectiveParser extends AbstractParser {

    private volatile Set<String> known = Collections.emptySet();

    void setKnown(Set<String> keys) {
        known = keys == null ? Collections.emptySet() : keys;
    }

    @Override
    public ParseResult parse(RSyntaxDocument doc, String style) {
        DefaultParseResult result = new DefaultParseResult(this);
        String text;
        try {
            text = doc.getText(0, doc.getLength());
        } catch (BadLocationException e) {
            return result;
        }
        Element lines = doc.getDefaultRootElement();
        Set<String> names = known;
        for (PageIncludes.Include inc : PageIncludes.find(text)) {
            if (inc.duplicate) {
                notice(result, lines, inc.start, inc.end - inc.start,
                    "This directive appears more than once. Fishbowl replaces every copy, comments and strings included.");
            } else if (!names.isEmpty() && !names.contains(inc.key())) {
                notice(result, lines, inc.start, inc.end - inc.start,
                    "No active " + inc.type + " is named \"" + inc.name.replace('_', ' ') + "\".");
            }
        }
        Map<String, Integer> tokens = PageIncludes.settingTokens(text, QueryParamTypeConst.getRegex());
        for (Map.Entry<String, Integer> t : tokens.entrySet()) {
            if (t.getValue() > 1) {
                Matcher m = Pattern.compile(Pattern.quote(t.getKey())).matcher(text);
                while (m.find()) {
                    notice(result, lines, m.start(), m.end() - m.start(),
                        "This setting token appears " + t.getValue() + " times; Fishbowl substitutes each copy. Write it once.");
                }
            }
        }
        return result;
    }

    private void notice(DefaultParseResult result, Element lines, int offset, int length, String message) {
        int line = lines.getElementIndex(offset);
        DefaultParserNotice n = new DefaultParserNotice(this, message, line, offset, Math.max(1, length));
        n.setLevel(ParserNotice.Level.WARNING);
        n.setShowInEditor(true);
        result.addNotice(n);
    }
}
