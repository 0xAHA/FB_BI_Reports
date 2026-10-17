package com.fbi.plugins.reportbtn.docs;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The module documents an app can replace. A slot is a row of Fishbowl's module
 * table: the module's own row is the document its Print and Email produce, and the
 * other rows (isModule = 0) are its extra documents, e.g. "Sales Order Invoice".
 * Module Options sets a Jasper report for each; the PoC lets an app stand in.
 */
final class DocSlots {

    /** Which of the client's email templates a document uses. */
    enum Mail { SO, PO, SHIP, GENERIC }

    static final class Module {
        final String name;    // the client module's name
        final String code;    // FB_LAUNCH module code (docs/launch-context.md §3)
        final String table;   // the record's table
        final String noun;    // for messages
        final Mail mail;
        final List<Slot> slots = new ArrayList<>();

        Module(String name, String code, String table, String noun, Mail mail) {
            this.name = name;
            this.code = code;
            this.table = table;
            this.noun = noun;
            this.mail = mail;
        }

        Slot main() {
            return slots.get(0);
        }
    }

    static final class Slot {
        final Module module;
        final String name;    // the module table row's name
        final String title;   // in menus and the attachment's file name

        Slot(Module module, String name, String title) {
            this.module = module;
            this.name = name;
            this.title = title;
        }

        /** The module's own row: the document the stock Print and Email produce. */
        boolean main() {
            return module.slots.get(0) == this;
        }

        @Override
        public String toString() {
            return name;
        }
    }

    private static final List<Module> MODULES;

    static {
        List<Module> m = new ArrayList<>();
        m.add(module("Sales Order", "SO", "so", "sales order", Mail.SO,
            "Sales Order", "Sales order", "Sales Order Invoice", "Invoice"));
        m.add(module("Purchase Order", "PO", "po", "purchase order", Mail.PO,
            "Purchase Order", "Purchase order"));
        m.add(module("Picking", "PICK", "pick", "pick", Mail.GENERIC,
            "Picking", "Pick ticket"));
        m.add(module("Shipping", "SHIP", "ship", "shipment", Mail.SHIP,
            "Shipping", "Packing slip", "Shipping Invoice", "Shipping invoice"));
        m.add(module("Work Order", "WO", "wo", "work order", Mail.GENERIC,
            "Work Order", "Work order", "Work Order Traveler", "Traveler", "Work Order Pick Report", "Pick report"));
        m.add(module("Manufacture Order", "MO", "mo", "manufacture order", Mail.GENERIC,
            "Manufacture Order", "Manufacture order", "Manufacture Order Projected Cost", "Projected cost"));
        m.add(module("Transfer Order", "TO", "xo", "transfer order", Mail.GENERIC,
            "Transfer Order", "Transfer order"));
        m.add(module("RMA", "RMA", "rma", "RMA", Mail.GENERIC,
            "RMA", "RMA"));
        MODULES = Collections.unmodifiableList(m);
    }

    private DocSlots() {
    }

    private static Module module(String name, String code, String table, String noun, Mail mail, String... slots) {
        Module mod = new Module(name, code, table, noun, mail);
        for (int i = 0; i + 1 < slots.length; i += 2) {
            mod.slots.add(new Slot(mod, slots[i], slots[i + 1]));
        }
        return mod;
    }

    static List<Module> modules() {
        return MODULES;
    }

    /** The module of this client module name, or null when the PoC doesn't cover it. */
    static Module module(String moduleName) {
        for (Module m : MODULES) {
            if (m.name.equalsIgnoreCase(moduleName)) {
                return m;
            }
        }
        return null;
    }

    static Slot slot(String slotName) {
        for (Module m : MODULES) {
            for (Slot s : m.slots) {
                if (s.name.equalsIgnoreCase(slotName)) {
                    return s;
                }
            }
        }
        return null;
    }

    /** Every slot, in table order. */
    static List<Slot> all() {
        List<Slot> out = new ArrayList<>();
        for (Module m : MODULES) {
            out.addAll(m.slots);
        }
        return out;
    }

    /** The attachment's file name: "Sales order 10042.pdf", without characters Windows refuses. */
    static String fileName(Slot slot, String num) {
        String base = slot.title + (Docs.blank(num) ? "" : " " + num.trim());
        return base.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "-") + ".pdf";
    }

    /** For the self-check: the slot names in order. */
    static List<String> names() {
        List<String> out = new ArrayList<>();
        for (Slot s : all()) {
            out.add(s.name);
        }
        return out;
    }

    static List<String> moduleNames() {
        List<String> out = new ArrayList<>();
        for (Module m : MODULES) {
            out.add(m.name);
        }
        return Arrays.asList(out.toArray(new String[0]));
    }
}
