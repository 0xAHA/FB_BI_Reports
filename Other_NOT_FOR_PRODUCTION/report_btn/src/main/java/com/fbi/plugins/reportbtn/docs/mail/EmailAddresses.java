package com.fbi.plugins.reportbtn.docs.mail;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The addresses the email window's address book offers, in the stock window's two
 * tabs: the record's customer or vendor (the order's own address, then the account's
 * email contacts from the Customer / Vendor module's Addresses tab), and the company
 * (the company's own email contacts, then the Fishbowl users with an email address).
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

    /** The address book's two tabs. */
    public static final class Book {
        /** "Customer" or "Vendor": the first tab's title. */
        public final String recordTab;
        public final List<Address> record;
        public final List<Address> company;
        /** The template type (SO, PO, SHIP, GENERIC): the stock address book's email type. */
        public final String mailType;

        public Book(String recordTab, List<Address> record, List<Address> company, String mailType) {
            this.recordTab = recordTab;
            this.mailType = mailType;
            this.record = record;
            this.company = company;
        }
    }

    private EmailAddresses() {
    }

    /** "Customer" for a record whose account is a customer, "Vendor" for a PO (or a PO shipment). */
    public static String recordTab(String code, List<Address> record) {
        if ("PO".equals(code)) {
            return "Vendor";
        }
        for (Address a : record) {
            if (a.source != null && a.source.startsWith("Vendor ")) {
                return "Vendor";
            }
        }
        return "Customer";
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
            contacts(sql, a.get("acc"), a.get("kind") + " " + (a.get("who") == null ? "" : a.get("who").trim()), seen, out);
        }
        return out;
    }

    /** The company tab: the company's own email contacts, then the Fishbowl users. */
    public static List<Address> company(EmailTokens.Rows sql) {
        List<Address> out = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Map<String, String> a : sql.rows("SELECT accountId AS acc, name AS who FROM company ORDER BY id", "acc", "who")) {
            contacts(sql, a.get("acc"), "Company", seen, out);
        }
        Set<String> have = new HashSet<>();
        for (Address a : out) {
            have.add(a.email.toLowerCase(Locale.ROOT));
        }
        for (Address u : users(sql)) {
            if (have.add(u.email.toLowerCase(Locale.ROOT))) {
                out.add(u);
            }
        }
        return out;
    }

    /** Any contact of the account holding an address, whatever its type is called; the default ones first. */
    private static void contacts(EmailTokens.Rows sql, String acc, String source, Set<String> seen, List<Address> out) {
        if (acc == null || !acc.trim().matches("\\d+")) {
            return;
        }
        for (Map<String, String> c : sql.rows("SELECT TRIM(ct.contactName) AS name, ct.datus AS email, ad.name AS addr "
                + "FROM contact ct LEFT JOIN address ad ON ad.id = ct.addressId WHERE ct.accountId = " + acc.trim()
                + " AND ct.datus LIKE '%_@_%' ORDER BY ct.defaultFlag+0 DESC, ad.name, ct.contactName, ct.id",
                "name", "email", "addr")) {
            String name = blank(c.get("name")) ? c.get("addr") : c.get("name");
            for (String e : EmailDraft.split(c.get("email"))) {
                if (e.contains("@") && seen.add(source + "|" + e.toLowerCase(Locale.ROOT))) {
                    out.add(new Address(name, e, source));
                }
            }
        }
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
                if (e.contains("@") && seen.add(e.toLowerCase(Locale.ROOT))) {
                    out.add(new Address(name, e, "Fishbowl user"));
                }
            }
        }
        return out;
    }

    /** How an address goes in a field: Name &lt;email&gt;, the name quoted when it holds a separator. */
    public static String display(Address a) {
        if (blank(a.name) || a.name.equalsIgnoreCase(a.email)) {
            return a.email;
        }
        String n = a.name;
        if (n.matches(".*[,;\"<>()@\\[\\]:\\\\].*")) {
            n = "\"" + n.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
        }
        return n + " <" + a.email + ">";
    }

    /** The field's text with the address added at the end, unless the field already has that email. */
    public static String append(String field, Address a) {
        List<String> have = EmailDraft.split(field);
        String want = a.email.toLowerCase(Locale.ROOT);
        for (String h : have) {
            if (emailOf(h).equals(want)) {
                return field == null ? "" : field;
            }
        }
        have.add(display(a));
        return EmailDraft.join(have);
    }

    /** The bare, lower-case email of "Name &lt;email&gt;" or "email". */
    static String emailOf(String entry) {
        String s = entry.trim();
        int lt = s.lastIndexOf('<'), gt = s.lastIndexOf('>');
        if (lt >= 0 && gt > lt) {
            s = s.substring(lt + 1, gt);
        }
        return s.trim().toLowerCase(Locale.ROOT);
    }

    private static boolean blank(String s) {
        return s == null || s.trim().isEmpty();
    }
}
