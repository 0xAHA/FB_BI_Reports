package com.fbi.plugins.reportbtn.docs.mail;

import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The template tokens the client's email window fills (EmailClientConst), read here
 * for one record: @ORDERNUM, @BILLTONAME, @SHIPTONAME, @CUSTOMERPO, @VENDORCONTACT,
 * @TRACKINGNUM, @USER and @DATE. Also the record's email address, the default To.
 */
public final class EmailTokens {

    /** Runs a SELECT: rows as maps of the named columns. */
    public interface Rows {
        List<Map<String, String>> rows(String sql, String... columns);
    }

    public static final class Record {
        public final Map<String, String> tokens = new LinkedHashMap<>();
        public final List<String> to = new ArrayList<>();
    }

    public static final String[] NAMES = {"@ORDERNUM", "@BILLTONAME", "@SHIPTONAME", "@CUSTOMERPO", "@VENDORCONTACT",
        "@TRACKINGNUM", "@USER", "@DATE"};

    private EmailTokens() {
    }

    /** The tokens for a record of this FB_LAUNCH code (SO, PO, SHIP, …) in this table. */
    public static Record forRecord(Rows sql, String code, String table, int id, int userId) {
        Record r = new Record();
        for (String n : NAMES) {
            r.tokens.put(n, "");
        }
        Map<String, String> row = null;
        switch (code) {
            case "SO":
                row = first(sql.rows("SELECT so.num AS ordernum, so.billToName AS billto, so.shipToName AS shipto, "
                    + "so.customerPO AS custpo, so.email AS email FROM so WHERE so.id = " + id,
                    "ordernum", "billto", "shipto", "custpo", "email"));
                break;
            case "PO":
                row = first(sql.rows("SELECT po.num AS ordernum, po.remitToName AS billto, po.shipToName AS shipto, "
                    + "po.customerSO AS custpo, po.vendorContact AS vendorcontact, po.email AS email FROM po WHERE po.id = " + id,
                    "ordernum", "billto", "shipto", "custpo", "vendorcontact", "email"));
                break;
            case "SHIP":
                row = first(sql.rows("SELECT COALESCE(so.num, po.num, xo.num, ship.num) AS ordernum, so.billToName AS billto, "
                    + "ship.shipToName AS shipto, so.customerPO AS custpo, COALESCE(so.email, po.email) AS email, "
                    + "c.name AS carrier FROM ship LEFT JOIN so ON so.id = ship.soId LEFT JOIN po ON po.id = ship.poId "
                    + "LEFT JOIN xo ON xo.id = ship.xoId LEFT JOIN carrier c ON c.id = ship.carrierId WHERE ship.id = " + id,
                    "ordernum", "billto", "shipto", "custpo", "email", "carrier"));
                List<String> nums = new ArrayList<>();
                for (Map<String, String> t : sql.rows("SELECT trackingNum AS t FROM shipcarton WHERE shipId = " + id
                        + " AND trackingNum IS NOT NULL AND trackingNum <> '' ORDER BY id", "t")) {
                    nums.add(t.get("t").trim());
                }
                r.tokens.put("@TRACKINGNUM", tracking(row == null ? null : row.get("carrier"), nums));
                break;
            default:
                if (table != null && table.matches("[a-z]+")) {
                    row = first(sql.rows("SELECT num AS ordernum FROM " + table + " WHERE id = " + id, "ordernum"));
                }
        }
        if (row != null) {
            put(r, "@ORDERNUM", row.get("ordernum"));
            put(r, "@BILLTONAME", row.get("billto"));
            put(r, "@SHIPTONAME", row.get("shipto"));
            put(r, "@CUSTOMERPO", row.get("custpo"));
            put(r, "@VENDORCONTACT", row.get("vendorcontact"));
            r.to.addAll(EmailDraft.split(row.get("email")));
        }
        Map<String, String> user = first(sql.rows("SELECT TRIM(CONCAT(COALESCE(firstName, ''), ' ', COALESCE(lastName, ''))) AS name, "
            + "userName AS login FROM sysuser WHERE id = " + userId, "name", "login"));
        if (user != null) {
            put(r, "@USER", blank(user.get("name")) ? user.get("login") : user.get("name"));
        }
        r.tokens.put("@DATE", DateFormat.getDateInstance(DateFormat.SHORT).format(new Date()));
        return r;
    }

    /** "Tracking Number(s) from: Carrier: 1Z…, 1Z…", as the stock window words it; "" with none. */
    public static String tracking(String carrier, List<String> nums) {
        if (nums == null || nums.isEmpty()) {
            return "";
        }
        return "Tracking Number(s) from: " + (blank(carrier) ? "" : carrier.trim() + ": ") + String.join(", ", nums);
    }

    /** text with each token replaced, longest first; in HTML the values are escaped. */
    public static String apply(String text, Map<String, String> tokens, boolean html) {
        if (text == null || text.isEmpty()) {
            return text == null ? "" : text;
        }
        List<String> keys = new ArrayList<>(tokens.keySet());
        keys.sort(Comparator.comparingInt(String::length).reversed());
        String out = text;
        for (String k : keys) {
            String v = tokens.get(k) == null ? "" : tokens.get(k);
            out = out.replace(k, html ? EmailTemplates.escape(v).replace("\n", "<br>") : v);
        }
        return out;
    }

    private static void put(Record r, String token, String value) {
        if (!blank(value)) {
            r.tokens.put(token, value.trim());
        }
    }

    private static Map<String, String> first(List<Map<String, String>> rows) {
        return rows == null || rows.isEmpty() ? null : rows.get(0);
    }

    private static boolean blank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
