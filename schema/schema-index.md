# Fishbowl Advanced — Database Schema Index

This is the starting point for any database work. Read this file first. Load domain files only as needed.

---

## Naming Conventions & Patterns

These conventions apply universally across the schema. Understanding them means you can infer relationships without reading every column definition.

### Foreign Key Naming

Fields ending in `Id` follow a predictable naming rule: strip the `Id` suffix, lowercase the result, and that is the referenced table name.

| Field name | References |
|---|---|
| `customerId` | `customer.id` |
| `vendorId` | `vendor.id` |
| `partId` | `part.id` |
| `productId` | `product.id` |
| `locationId` | `location.id` |
| `locationGroupId` | `locationgroup.id` |
| `userId` | `sysuser.id` |
| `uomId` | `uom.id` |
| `carrierId` | `carrier.id` |
| `taxRateId` | `taxrate.id` |
| `qbClassId` | `qbclass.id` |
| `currencyId` | `currency.id` |
| `paymentTermsId` | `paymentterms.id` |
| `shipTermsId` | `shipterms.id` |
| `fobPointId` | `fobpoint.id` |
| `bomId` | `bom.id` |
| `soId` | `so.id` |
| `poId` | `po.id` |
| `moId` | `mo.id` |
| `woId` | `wo.id` |
| `xoId` | `xo.id` |
| `rmaId` | `rma.id` |
| `pickId` | `pick.id` |
| `shipId` | `ship.id` |
| `receiptId` | `receipt.id` |

**Exceptions (non-standard names):**
- `moItemId` → `moitem.id`
- `soItemId` → `soitem.id`
- `poItemId` → `poitem.id`
- `xoItemId` → `xoitem.id`
- `woItemId` → `woitem.id`
- `rmaItemId` → `rmaitem.id`
- `bomItemId` → `bomitem.id`
- `shipCartonId` → `shipcarton.id`
- `fromLGId` / `shipToLGId` → `locationgroup.id` (transfer order)
- `parentId` → self-referential (same table) unless context indicates otherwise
- `tagId` → `tag.id` (note: `tag.id` is `bigint`, not `int`)
- `stateId` → `stateconst.id`
- `countryId` → `countryconst.id`

### Column Prefix/Suffix Patterns

| Pattern | Meaning |
|---|---|
| `mc` prefix | Multi-currency shadow of the adjacent cost/price column — stores value in the transaction currency rather than home currency. e.g. `mcTotalPrice` mirrors `totalPrice` |
| `activeFlag` | `bit` — filter with `= 1` for active records |
| `statusId` | `int` — references a status lookup; see Status ID Reference below |
| `typeId` | `int` — references a type lookup table |
| `dateCreated` | `datetime` — when the record was created |
| `dateLastModified` | `datetime` — last update timestamp |
| `customFields` | `json` — user-defined custom field data; present on most main tables |
| `num` | `varchar` — the human-readable identifier (order number, part number, etc.) |
| `_aud` suffix | Audit/history table — mirrors the main table's columns plus `REV` and `REVTYPE` for change tracking |

### Transfer Orders

Transfer Orders use the table name **`xo`** — not `to`, which is a reserved SQL keyword.

### All Table Names Are Lowercase

MySQL is case-insensitive on Windows and macOS but case-sensitive on Linux. Always use lowercase table names (`so`, `locationgroup`, `partreorder`) to be safe on all platforms.

### Query Result Keys Are Always Lowercase

`QueryRow` lowercases all column names before returning results. Write `row.statusid`, not `row.statusId`. This applies regardless of how you write aliases in SQL.

---

## Domain Files

Load only the file(s) relevant to the report you are building.

| File | Tables | Load when building reports about |
|---|---|---|
| `schema-orders.sql` | 30 | Sales orders, purchase orders, manufacture orders, work orders, transfer orders, RMAs and their line items, status/type lookups for each |
| `schema-fulfillment.sql` | 17 | Picking, shipping, receiving and their line items, cartons, status/type lookups |
| `schema-inventory.sql` | 29 | On-hand quantities, locations, lot/serial tracking, cost layers, inventory adjustments, movement logs |
| `schema-parts-products.sql` | 23 | Parts, products, BOMs, kits, units of measure, product tree/categories |
| `schema-customers-vendors.sql` | 16 | Customers, vendors, addresses, contacts, associated pricing, customer/vendor part numbers |
| `schema-setup.sql` | 39 | Users, currencies, carriers, payment terms, tax rates, shipping terms, custom fields, QB classes, company info |
| `schema-accounting.sql` | 19 | QuickBooks posting records, accounting transactions, payment processing (wallet, card on file, payment gateway) |
| `schema-system.sql` | 40 | Integrations, scheduling, BI metadata, system config, notifications — rarely needed for BI reports |
| `schema-audit.sql` | 107 | Change history for all main tables (`_aud` suffix) — large; load only when auditing data changes |
| `schema-views.sql` | 49 views | Custom reports using quantity summaries, address formatting, shipping detail, or part tracking |

### Common multi-file combinations

- **Open order dashboard** → `schema-orders.sql` + `schema-customers-vendors.sql`
- **Inventory report** → `schema-inventory.sql` + `schema-parts-products.sql`
- **Receiving / fulfillment report** → `schema-fulfillment.sql` + `schema-orders.sql`
- **Part cost / valuation report** → `schema-inventory.sql` + `schema-parts-products.sql` + `schema-setup.sql` (for currency)
- **Customer report** → `schema-customers-vendors.sql` + `schema-orders.sql`
- **Vendor / purchasing report** → `schema-customers-vendors.sql` + `schema-orders.sql`
- **Accounting / QB posting report** → `schema-accounting.sql` + `schema-orders.sql`
- **Audit / change history report** → `schema-audit.sql` + relevant domain file

---

## Status ID Reference

### `so.statusId` — Sales Order
| ID | Label |
|---|---|
| 10 | Estimate |
| 20 | Issued |
| 25 | In Progress |
| 60 | Fulfilled |
| 70 | Closed Short |
| 80 | Voided |
| 85 | Cancelled |
| 90 | Expired |

### `soitem.statusId` — Sales Order Item
| ID | Label |
|---|---|
| 10 | Entered |
| 11 | Awaiting Build |
| 12 | Building |
| 14 | Built |
| 20 | Picking |
| 30 | Partial |
| 40 | Picked |
| 50 | Fulfilled |
| 60 | Closed Short |
| 70 | Voided |
| 75 | Cancelled |

### `po.statusId` — Purchase Order
| ID | Label |
|---|---|
| 10 | Bid Request |
| 15 | Pending Approval |
| 20 | Issued |
| 30 | Picking |
| 40 | Partial |
| 50 | Picked |
| 55 | Shipped |
| 60 | Fulfilled |
| 70 | Closed Short |
| 80 | Void |

### `mo.statusId` — Manufacture Order
| ID | Label |
|---|---|
| 10 | Entered |
| 20 | Issued |
| 50 | Partial |
| 60 | Fulfilled |
| 70 | Closed Short |
| 80 | Void |

### `moitem.statusId` — Manufacture Order Item
| ID | Label |
|---|---|
| 10 | Entered |
| 20 | Picking |
| 30 | Working |
| 40 | Partial |
| 50 | Fulfilled |
| 60 | Closed Short |
| 70 | Void |

### `wo.statusId` — Work Order
| ID | Label |
|---|---|
| 10 | Entered |
| 30 | Started |
| 40 | Fulfilled |

### `pick.statusId` — Pick
| ID | Label |
|---|---|
| 10 | Entered |
| 20 | Started |
| 30 | Committed |
| 40 | Finished |

### `ship.statusId` — Ship
| ID | Label |
|---|---|
| 10 | Entered |
| 20 | Packed |
| 30 | Shipped |

---

## Views

Fishbowl defines 49 MySQL views documented in `schema-views.sql`. The application does not use them at runtime — they exist for custom reports only.

**MySQL uses two algorithms for views:**
- **MERGE** — the outer `WHERE` is merged into the view SQL and indexes on base tables are used. Safe to filter.
- **TEMPTABLE** — the view is fully materialized into a temp table first, then the outer `WHERE` is applied. No predicate pushdown.

TEMPTABLE is forced by `GROUP BY`, `UNION`, `DISTINCT`, or aggregate functions. All quantity views fall into this category.

**Do not query TEMPTABLE views with a `WHERE` clause.** A query like `SELECT * FROM QTYINVENTORY WHERE partid = 5` scans and aggregates every tag and order record first, then discards rows. Instead, reproduce the relevant sub-query inline with your filter baked in — the base tables (`tag`, `soitem`, `poitem`, etc.) are indexed. See the inline examples at the top of `schema-views.sql`.

Each view in `schema-views.sql` is annotated with its algorithm (MERGE or TEMPTABLE).

---

## Common Join Patterns

```sql
-- SO with customer
FROM so JOIN customer c ON c.id = so.customerId

-- SO line items
FROM so JOIN soitem soi ON soi.soId = so.id

-- PO with vendor
FROM po JOIN vendor v ON v.id = po.vendorId

-- PO line items with part
FROM po
JOIN poitem poi ON poi.poId = po.id
JOIN part p ON p.id = poi.partId

-- MO line items (description is on moitem directly — no need to join part for display)
FROM mo JOIN moitem moi ON moi.moId = mo.id

-- Transfer order with both location groups
FROM xo
JOIN locationgroup fromlg ON fromlg.id = xo.fromLGId
JOIN locationgroup tolg   ON tolg.id   = xo.shipToLGId

-- On-hand inventory by part and location group
FROM part p
JOIN tag t          ON t.partId         = p.id
JOIN location l     ON l.id             = t.locationId
JOIN locationgroup lg ON lg.id          = l.locationGroupId

-- On-hand totals by part and location group
SELECT p.num, p.description, lg.name AS locationGroup,
       SUM(t.qty) AS onHand, SUM(t.qtyCommitted) AS committed
FROM part p
JOIN tag t          ON t.partId         = p.id
JOIN location l     ON l.id             = t.locationId
JOIN locationgroup lg ON lg.id          = l.locationGroupId
WHERE p.activeFlag = 1
GROUP BY p.id, p.num, p.description, lg.id, lg.name

-- Reorder points with current on-hand
SELECT p.num, pr.reorderPoint, pr.orderUpToLevel,
       COALESCE(SUM(t.qty), 0) AS onHand
FROM part p
JOIN partreorder pr ON pr.partId = p.id
LEFT JOIN tag t      ON t.partId = p.id
LEFT JOIN location l ON l.id = t.locationId AND l.locationGroupId = pr.locationGroupId
WHERE p.activeFlag = 1
GROUP BY p.id, p.num, pr.locationGroupId, pr.reorderPoint, pr.orderUpToLevel

-- Vendor parts with last cost
FROM vendorparts vp
JOIN vendor v ON v.id = vp.vendorId
JOIN part p   ON p.id = vp.partId

-- Customer part numbers
FROM customerparts cp
JOIN customer c  ON c.id   = cp.customerId
JOIN product prod ON prod.id = cp.productId
```
