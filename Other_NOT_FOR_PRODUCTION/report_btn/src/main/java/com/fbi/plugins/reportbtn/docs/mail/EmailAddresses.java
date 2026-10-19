package com.fbi.plugins.reportbtn.docs.mail;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The addresses the email window offers under its To, Cc and Bcc buttons: the email contacts of the
 * record's customer or vendor (Customer / Vendor module, Addresses tab), and the
 * Fishbowl users with an email address.
 */
public final class EmailAddresses {

    /** One address and where it came from ("Customer Acme Ltd", "Fishbowl user"). */
    public static final class Address {
        public final String name;
        public final String email;
        public final String source;

        public Address(String name, String email, String source) {
            this.name = name == null ? "" : name.trim();
            this.email = email.trim();
            this.source = source;
        }
    }

    private EmailAddresses() {
    }

    /**
     * The contacts of the account behind a record of this FB_LAUNCH code: the customer
     * of a sales order, RMA or SO shipment, the vendor of a purchase order or PO
     * shipment. Other modules have none.
     */
    public static List<Address> forRecord(EmailTokens.Rows sql, String code, int id) {
        String accounts;
        switch (code == null ? "" : code) {
            case "SO":
                accounts = "SELECT cu.accountId AS acc, cu.name AS who, 'Customer' AS kind FROM so "
                    + "JOIN customer cu ON cu.id = so.customerId WHERE so.id = " + id;
                break;
            case "RMA":
                accounts = "SELECT cu.accountId AS acc, cu.name AS who, 'Customer' AS kind FROM rma "
                    + "JOIN customer cu ON cu.id = rma.customerId WHERE rma.id = " + id;
                break;
            case "PO":
                accounts = "SELECT v.accountId AS acc, v.name AS who, 'Vendor' AS kind FROM po "
                    + "JOIN vendor v ON v.id = po.vendorId WHERE po.id = " + id;
                break;
            case "SHIP":
                accounts = "SELECT cu.accountId AS acc, cu.name AS who, 'Customer' AS kind FROM ship "
                    + "JOIN so ON so.id = ship.soId JOIN customer cu ON cu.id = so.customerId WHERE ship.id = " + id
                    + " UNION ALL SELECT v.accountId AS acc, v.name AS who, 'Vendor' AS kind FROM ship "
                    + "JOIN po ON po.id = ship.poId JOIN vendor v ON v.id = po.vendorId WHERE ship.id = " + id;
                break;
            default:
                return new ArrayList<>();
        }
        List<Address> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, String> a : sql.rows(accounts, "acc", "who", "kind")) {
            String acc = a.get("acc");
            if (acc == null || !acc.trim().matches("\\d+")) {
                continue;
            }
            String source = a.get("kind") + " " + (a.get("who") == null ? "" : a.get("who").trim());
            // Any contact holding an address, whatever its type is called; the default ones first.
            for (Map<String, String> c : sql.rows("SELECT TRIM(ct.contactName) AS name, ct.datus AS email, ad.name AS addr "
                    + "FROM contact ct LEFT JOIN address ad ON ad.id = ct.addressId WHERE ct.accountId = " + acc.trim()
                    + " AND ct.datus LIKE '%_@_%' ORDER BY ct.defaultFlag+0 DESC, ad.name, ct.contactName, ct.id",
                    "name", "email", "addr")) {
                String name = blank(c.get("name")) ? c.get("addr") : c.get("name");
                for (String e : EmailDraft.split(c.get("email"))) {
                    if (e.contains("@") && seen.add(source + "|" + e.toLowerCase())) {
                        out.add(new Address(name, e, source));
                    }
                }
            }
        }
        return out;
    }

    /** Active Fishbowl users with an email address, by name. */
    public static List<Address> users(EmailTokens.Rows sql) {
        List<Address> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, String> u : sql.rows("SELECT TRIM(CONCAT(COALESCE(firstName, ''), ' ', COALESCE(lastName, ''))) AS name, "
                + "userName AS login, email AS email FROM sysuser WHERE activeFlag = 1 AND email LIKE '%_@_%' "
                + "ORDER BY firstName, lastName, userName", "name", "login", "email")) {
            String name = blank(u.get("name")) ? u.get("login") : u.get("name");
            for (String e : EmailDraft.split(u.get("email"))) {
                if (e.contains("@") && seen.add(e.toLowerCase())) {
                    out.add(new Address(name, e, "Fishbowl user"));
                }
            }
        }
        return out;
    }

    /**
     * A field's addresses after its button's list: in the field's order, typed addresses that
     * aren't listed stay, listed ones stay while ticked, then the newly ticked ones in
     * list order. No address twice (case-insensitive).
     */
    public static List<String> merge(List<Address> list, boolean[] ticked, List<String> current) {
        Set<String> listed = new HashSet<>();
        Set<String> picked = new HashSet<>();
        for (int i = 0; i < list.size(); i++) {
            String k = list.get(i).email.toLowerCase(Locale.ROOT);
            listed.add(k);
            if (ticked[i]) {
                picked.add(k);
            }
        }
        List<String> out = new ArrayList<>();
        Set<String> have = new HashSet<>();
        for (String a : current) {
            String k = a.toLowerCase(Locale.ROOT);
            if ((!listed.contains(k) || picked.contains(k)) && have.add(k)) {
                out.add(a);
            }
        }
        for (int i = 0; i < list.size(); i++) {
            String e = list.get(i).email;
            if (ticked[i] && have.add(e.toLowerCase(Locale.ROOT))) {
                out.add(e);
            }
        }
        return out;
    }

    private static boolean blank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
