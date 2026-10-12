package com.fbi.plugins.reportbtn;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Client module -> its tag key, record-type code, table and naming column.
 *
 * tag: the module's key in a report's fb-launch tag, one per module, which
 * decides where a report is listed. It is the record code, except where two
 * modules send the same record type: Inventory (INVENTORY) and Consignment
 * (CONSIGNMENT). Unknown modules use a key made from their name.
 *
 * Each row is what that module's getObjectId() returns, read from its client
 * class (26.9.1), e.g. SOModuleClient -> SalesOrderFpo.getId(). Note Inventory
 * returns a PART id and Consignment a LOCATION id. Codes are Fishbowl's own
 * report-setting codes (QueryParamTypeConst) where one exists; RMA and the setup
 * modules have none, so they use the module's own enum name. Any other module
 * gets a code derived from its name and no table.
 * Keep in step with LAUNCH_CONTEXT.md and FBDoc.launch.MODULES.
 */
final class ModuleCodes {

    static final class Entry {
        final String tag;            // this module's key in the fb-launch tag
        final String code;           // record type sent as FB_LAUNCH.module
        final String table;          // null when the record type is unknown
        final String labelColumn;    // the column that names a record, or null

        Entry(String tag, String code, String table, String labelColumn) {
            this.tag = tag;
            this.code = code;
            this.table = table;
            this.labelColumn = labelColumn;
        }
    }

    private static final Map<String, Entry> BY_MODULE = new HashMap<>();

    static {
        // Orders and fulfilment
        add("Sales Order", "SO", "so", "num");
        add("Purchase Order", "PO", "po", "num");
        add("Manufacture Order", "MO", "mo", "num");
        add("Work Order", "WO", "wo", "num");
        add("Transfer Order", "TO", "xo", "num");
        add("Picking", "PICK", "pick", "num");
        add("Shipping", "SHIP", "ship", "num");
        add("Receiving", "RECEIPT", "receipt", null);        // receipt has no number column
        add("RMA", "RMA", "rma", "num");
        // Items
        add("Part", "PART", "part", "num");
        add("Inventory", "INVENTORY", "PART", "part", "num");            // InvBusinessLogic.getPartID()
        add("Product", "PROD", "product", "num");
        add("Bill of Materials", "BOM", "bom", "num");
        // Contacts and places
        add("Customer", "CUST", "customer", "name");
        add("Vendor", "VEND", "vendor", "name");
        add("Carrier", "CAR", "carrier", "name");
        add("Location", "LOC", "location", "name");
        add("Consignment", "CONSIGNMENT", "LOC", "location", "name");    // LocationFpo.getId()
        add("Location Group", "LG", "locationgroup", "name");
        add("Class", "CLASS", "qbclass", "name");
        add("User", "USER", "sysuser", "userName");
        // Setup records (no native setting code)
        add("User Group", "USER_GROUP", "usergroup", "name");
        add("Company", "COMPANY", "company", "name");
        add("Currency", "CURRENCY", "currency", "name");
        add("Pricing Rule", "PRICING_RULE", "pricingrule", "name");
        add("Tax Rate", "TAX_RATE", "taxrate", "name");
        add("Payment Terms", "PAYMENT_TERMS", "paymentterms", "name");
        add("UOM", "UOM", "uom", "name");
    }

    private ModuleCodes() {
    }

    private static void add(String moduleName, String code, String table, String labelColumn) {
        add(moduleName, code, code, table, labelColumn);
    }

    private static void add(String moduleName, String tag, String code, String table, String labelColumn) {
        BY_MODULE.put(moduleName.toLowerCase(Locale.ROOT), new Entry(tag, code, table, labelColumn));
    }

    /** The entry for a client module name; unknown modules get a key and code from their name, and no table. */
    static Entry of(String moduleName) {
        String name = moduleName == null ? "" : moduleName.trim();
        Entry known = BY_MODULE.get(name.toLowerCase(Locale.ROOT));
        if (known != null) {
            return known;
        }
        String derived = derivedCode(name);
        return new Entry(derived, derived, null, null);
    }

    /** "Location Group" -> "LOCATION_GROUP"; always a valid code. */
    static String derivedCode(String moduleName) {
        String code = moduleName.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", "_").replaceAll("^_+|_+$", "");
        if (code.isEmpty()) {
            return "MODULE";
        }
        return Character.isLetter(code.charAt(0)) ? code : "M_" + code;
    }
}
