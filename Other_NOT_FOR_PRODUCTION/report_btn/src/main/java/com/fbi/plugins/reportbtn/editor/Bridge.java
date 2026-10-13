package com.fbi.plugins.reportbtn.editor;

import com.fbi.sdk.constants.bi.JsFunctionConst;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * The functions Fishbowl gives every BI page: the native editor's list
 * (JsFunctionConst) plus the ones the page bridge has that the list leaves out.
 */
final class Bridge {

    static final class Fn {
        final String name;
        final String params;
        final String doc;

        Fn(String name, String params, String doc) {
            this.name = name;
            this.params = params;
            this.doc = doc;
        }

        String call() {
            return name + "(" + params + ")";
        }
    }

    private static final List<Fn> ALL;

    static {
        List<Fn> list = new ArrayList<>();
        for (JsFunctionConst f : JsFunctionConst.values()) {
            String example = f.getExample() == null ? "" : f.getExample().trim();
            int p = example.indexOf('(');
            String name = p > 0 ? example.substring(0, p).trim() : f.getName();
            String params = p > 0 && example.endsWith(")") ? example.substring(p + 1, example.length() - 1).trim() : "";
            if ("runApiRequest".equals(name)) {
                params = "name, jsonString";   // the bridge takes the request name and its JSON
            }
            list.add(new Fn(name, params, f.getDescription() == null ? "" : f.getDescription()));
        }
        add(list, "runQueryAsync", "query", "Runs a SELECT without blocking; resolves to the rows (column keys are lower case).");
        add(list, "getLocationGroupList", "", "The ids of the location groups the user can access.");
        add(list, "currencyLocale", "", "The home currency's { locale, symbol }.");
        add(list, "loadSettings", "key", "Reads a per-user setting.");
        add(list, "saveSettings", "key, value", "Saves a per-user setting.");
        add(list, "getAutoMo", "startDate, endDate, isIncludeNoRop, isIncludeConfigurable, locationGroupId, qbClassId",
            "The Auto MO wizard's data, as a JSON string (snake_case fields).");
        add(list, "getHighValueReport", "tableName, id", "A high-value (inventory valuation) report for a record.");
        add(list, "runPickStatusHelper", "pickId", "Recalculates a pick's status.");
        list.sort((a, b) -> a.name.compareToIgnoreCase(b.name));
        ALL = Collections.unmodifiableList(list);
    }

    private Bridge() {
    }

    private static void add(List<Fn> list, String name, String params, String doc) {
        for (Fn f : list) {
            if (f.name.equals(name)) {
                return;
            }
        }
        list.add(new Fn(name, params, doc));
    }

    static List<Fn> all() {
        return ALL;
    }
}
