# Fishbowl stock Shipping Invoice: implementation spec for an HTML rebuild

**Source folder:** `C:\Program Files\Fishbowl\server\reports\Ship\`

I read every line of `ShippingInvoice.jrxml`, `subShippingInvoice_AU.jrxml` and `subCarton.jrxml`. For all the other variants I diffed them against these with UUIDs removed.

**Files involved**

| Role | File |
|---|---|
| Dispatcher (master) | `ShippingInvoice.jrxml` (841 lines) |
| Invoice, by edition | `subShippingInvoice_AU.jrxml`, `subShippingInvoice_CA.jrxml`, `subShippingInvoice_US.jrxml` |
| Pro-forma, by edition | `subShippingProForma_AU.jrxml`, `subShippingProForma_CA.jrxml`, `subShippingProForma_US.jrxml` |
| Carton subreport | `subCarton.jrxml` |
| Ignore (see §4.5) | `ShippingInvoiceSpecialCharacters.jrxml`, `sub*_SpecialCharacters.jrxml`, `subCartonSpecialCharacters.jrxml` |

**Notation used below**
- `x`, `y`, `w`, `h` are in pt and relative to the band.
- Unless stated otherwise, text is Open Sans and the font colour is #000000.
- "Grey" means #EAEAEA.
- "Border 0.5" means a 0.5pt solid black line.

---

## 1. DISPATCH: `ShippingInvoice.jrxml`

### 1.1 Page
- Letter size: 612 × 792.
- All margins are 0. Column width is 612.
- `whenNoDataType="AllSectionsNoDetail"`.
- No styles are declared.

### 1.2 Query (verbatim)
```sql
SELECT 	PostSo.id AS POSTSOID,
	ship.STATUSID

FROM 	Ship
	INNER JOIN ShipItem ON Ship.id = ShipItem.shipId
	LEFT JOIN PostSoItem ON PostSoItem.shipItemId = ShipItem.id
	LEFT JOIN PostSo ON PostSo.id = PostSoItem.postSoId

WHERE 	ShipItem.shipId = $P{shipID}

LIMIT 1
```

**Fields**
- `POSTSOID` (Integer). This is null if the shipment has not been posted.
- `STATUSID` (Integer).

Ship status values (confirmed from the `ckEntered`/`ckPacked`/`ckShipped` parameters in `Batch\ByDate\PackingListByDate.jrxml`):
- 10 = Entered
- 20 = Packed
- 30 = Shipped
- 40 = Cancelled. This value is not in that file; it is the usual Fishbowl value.

### 1.3 Variable `country` (String, resetType None)
```java
com.fbi.util.PropertyUtil.isCaOrInternational() ? "CA" :
com.fbi.util.PropertyUtil.isAu() ? "AU" :
"US"
```
The edition comes from Fishbowl's accounting edition/region setting through Java helpers. No report parameter is involved.
- The CA check runs first and also covers "International".
- Everything else falls through to US.
- The `QBVersion="!US"` property on some sub parameters is only a hint for the options screen. It does not take part in dispatch.

### 1.4 Bands

**Background:** empty.

**Detail band (h 108)** contains one subreport:
- Position `x0 y0 w612 h108`, with `runToBottom="true"`.
- Parameters: `parametersMapExpression = $P{REPORT_PARAMETERS_MAP}`, so every master parameter (including evaluated defaults) is passed down under its own name.
- Connection: `$P{REPORT_CONNECTION}`.

The subreport file is chosen like this:
```java
$F{STATUSID} == 30 ?
    $P{path} + "subShippingInvoice_" + $V{country} + ".jasper"
    : $P{path} + "subShippingProForma_" + $V{country} + ".jasper"
```
- Status 30 (Shipped) gives the **Invoice**. Any other status (Entered, Packed, Cancelled and so on) gives the **ProForma**.
- `path` defaults to `"../Ship/"`.

The master also passes these explicit subreport parameters, on top of the parameter map:
- `colShippingTerms=$P{ShippingTerms}`
- `shipID=$P{shipID}`
- `colPaymentTerms`
- `colCurrencyExtendedPrice`
- `colQtyShipped`
- `colItemNumberAndDescription`
- `colItemLineNumber`
- `ShowHomeCurrencyTotals`
- `Column:CustomFooterText`
- `colShipVia`
- `ShowDeliverySignature`
- `ShowBillToEmail`
- `path`
- `colOrderCurrency`
- `ShowCompanyName`
- `ShowBillToFax`
- `colOrderCurrencyRate`
- `module`
- `colExtendedPrice`
- `colFOBPoint`
- `ShowBillToPhone`
- `colSalesPerson`
- `colUnitPrice`
- `cbOrderNumber`
- `ShowCurrencyTotals`
- `colCurrencyUnitPrice`
- **`postSoId=$F{POSTSOID}`**
- `colType`
- `colReqShipDate`
- `ShowCountry`

**None of the `col*` names are declared in any sub, so they are dead.** The subs read the plain names (`SalesPerson`, `UnitPrice` and so on), which arrive through the parameter map. Because master defaults are also in the map, the master defaults win over sub defaults. For example, `cbLogoAlignment` ends up as `"left"` even though the sub's own default is `"top"`.

**Page footer (h 34)**
- It prints on every page.
- On the page it sits at y = 758–792. In each text field the text occupies y 0–14.
- Every field below has `printWhen !$P{IS_IGNORE_PAGINATION}`, Open Sans 9pt, vertical-align bottom, a transparent background and no borders.

| Key | x | y | w | h | Align | Expression |
|---|---|---|---|---|---|---|
| textField-45 | 30 | 0 | 322 | 14 | left | `(DateFormat.getDateTimeInstance(DateFormat.LONG,DateFormat.LONG)).format(new Date())` (the time the report runs, server locale) |
| textField-43 | 352 | 0 | 209 | 14 | right, rightPadding 4 | `"Page " + $V{PAGE_NUMBER} + " of"` |
| textField-44 | 561 | 0 | 21 | 14 | left, `evaluationTime="Report"` | `$V{PAGE_NUMBER}`, which gives the total page count |

### 1.5 Master parameters

These are what the user sees in Fishbowl's report options. Defaults are shown in brackets.

**System / record ID**
- `shipID` (String, prompted). Tooltip: "Enter a fulfilled order number…". It is actually the `Ship.id`.
- `module` (Object, injected by Fishbowl). This is the `com.evnt.eve.modules.ReportHelperModule` instance.
- `path` (String, [`"../Ship/"`]).

**Address group**
- `ShowCountry` [false]
- `ShowBillToPhone` [true]
- `ShowBillToFax` [true]
- `ShowBillToEmail` [true]

**Hide/Show tab, Order Fields**
- `SalesPerson` [true]
- `PaymentTerms` [true]
- `FOBPoint` [true]
- `ShippingTerms` [`"PropertyNotMultiCurrency"`]. Note the missing space; see the gotchas.
- `ShipVia` [true]
- `ReqShipDate` [true]
- `OrderCurrency` [false]
- `OrderCurrencyRate` [false]
- `Column:CustomFooterText` [true]

**Hide/Show tab, Item Columns**
- `ItemLineNumber` [true]
- `Type` [true]
- `ItemNumberAndDescription` [false]
- `UnitPrice` [`"PropertyNotMulti Currency"`]
- `QtyShipped` [true]
- `ExtendedPrice` [`"PropertyNotMulti Currency"`]
- `CurrencyUnitPrice` [`"PropertyMulti Currency"`]
- `CurrencyExtendedPrice` [`"PropertyMulti Currency"`]
- `ItemDescription` [true]
- `ItemNumber` [true]
- `TaxCode` [true]
- `TaxAmount` [true]
- `ItemCurrencyTax` [false]

**Combo boxes**
- `cbOrderNumber` [`"Ship"`]. The options string is `SO,SO Number,PO,Customer PO Number,Ship,Ship Number`.
- `cbLogoAlignment` [`"left"`]. The options string is `top,Top,left,Left`.

**Totals**
- `ShowHomeCurrencyTotals` [false]. Only shown when Multi Currency is on.
- `ShowCurrencyTotals` [`Boolean.getBoolean("Multi Currency")`]. Only shown when Multi Currency is on.
- `ShowTotals` [true]. Only shown when Multi Currency is off.
- `ShowTotalQty` [false]

**Header**
- `ShowCompanyName` [true]
- `ShowBarcode` [true]

**Other Settings**
- `ShowDeliverySignature` [false]. This is the Fishbowl GO signature.
- `ShowCartonInfo` [false]
- `IncludeKitsInItemNumbering` [true]. The tooltip claims the opposite of what the logic does; see the gotchas.
- `ShowNote` [true]

**Field titles** (String, no default; Fishbowl passes `"%"` for "unset")
- `FieldTitle:Date`, `Order#`, `ShipTo`, `BillTo`
- `FieldTitle:PaymentTerms`, `FOBPoint`, `SalesPerson`, `ShippingTerms`, `Carrier`, `DateScheduled`, `OrderCurrency`, `CurrencyRate`
- `FieldTitle:Item#`, `Type`, `Description`, `Item`, `UnitPrice`, `QtyShipped`, `ExtendedPrice`, `TaxCode`, `TaxAmount`
- `FieldTitle:Total`, `Subtotal`, `SalesTax`
- `FieldTitle:InvoiceTitle`, `ProformaTitle`
- `FieldTitle:CartonInfo`, `Carton#`, `Weight`, `Tracking#`, `TotalWeight`, `Cartoncount`, `LxWxH`
- `FieldTitle:PayButton`

**Custom fields**
- `CustomField:Item1..3` (String; the picker property is `Table=soitem`). These are raw SQL.
- `FieldTitle:Itemcf1..3`
- `ShowCfItem1..3` [false]
- `ShowSOCustomFields` [false]
- `CustomField:SO1..6` (picker property `Table=SO`)
- `FieldTitle:SOcf1..6`
- `ShowCfSO1..6` [true]

**Payment Button**
- `ShowPayOnlineButton` [true]
- `PaymentText` [empty]
- `DisplayText` [true]
- Only the US subs use these three.

---

## 2. `subShippingInvoice_AU.jrxml` (the full spec)

### 2.1 Page and coordinate system
- Page 612 × 792, column width 552.
- Margins: left 30, right 30, top 20, bottom 20.
- `whenNoDataType="AllSectionsNoDetail"`.

How it maps onto the master page:
- The sub is placed at master (0,0) with `runToBottom`.
- The sub's height on each page is the master page minus the master footer: 792 − 34 = 758.
- The sub's own margins still apply. So the content box on every page runs from x 30 to 582 and from y 20 to 738.
- Page x = 30 + element x.
- The **last page footer (133) always sits at page y 605–738**. That is 758 − 20 − 133.

Band order on page 1:
1. Title. Only shown in the error case.
2. Page header (134).
3. CustomerAddress group header (77, can grow).
4. CartonInfo group header (19, optional).
5. Detail bands 1 to 4.
6. Last page footer (133, last page only, pinned to the bottom).

On page 2 and later:
- The page header repeats.
- The items table column header repeats (the default for JR tables).
- The address block does not repeat.
- There is no footer except on the last page. The master's "Page N of M" still prints on every page.

### 2.2 Styles and fonts
- Every style is Open Sans with `pdfEncoding Cp1252` and is not embedded.
- Named styles: "9", "10", "12", "14", "10b", "12b", "14b", "16b", "18b", "24b", "10i", "12i", "10bu", header1 (24b), header2 (18b), header3 (16b), addressHeader (14b), date (12), type (12), address (10 italic), column_head (10b).
- **Three styles are marked `isDefault="true"`: "10", "body" and "note" (9pt). JasperReports keeps the last one declared, so the effective default is "note": Open Sans 9pt regular.** Any element below that has no explicit size is therefore 9pt.
- `Barcode` style: centred horizontally and vertically, topPadding 0.
- `Zebra` style: conditional on `$V{PAGE_COUNT}.intValue() % 2 == 0`, which switches to mode Opaque with background #EAEAEA.
  - Inside a table, PAGE_COUNT is the row number on the current page.
  - So rows 2, 4, 6… on each page are grey, rows 1, 3, 5… are white, and the count restarts on every page.
- Text height tip: Open Sans line height is about 1.36 em. That is about 12.3pt at 9pt, about 13.6pt at 10pt and about 10.9pt at 8pt.

### 2.3 Parameters

The sub declares the same set as the master, with these differences.

**Record IDs**
- `shipID` (String).
- `postSoId` (Integer, no default; the master sets it to POSTSOID).
- `module` (Object).
- `path` (String, [`"../Ship/"`]).

**Declared only in the sub, never passed by the master**
- `ShowCompanyAddress` [true]
- `Order#Label` (String). Unused.

**Sub defaults that are overridden by the master map**
- `cbLogoAlignment`: sub default `"top"`; the master gives `"left"`.
- `ShowTotals`: sub default `!Boolean.getBoolean("Multi Currency")`; the master gives `true`.

**Hints for the options screen**
- `TaxCode`, `TaxAmount` and `ItemCurrencyTax` carry `QBVersion="!US"`.
- `CurrencyUnitPrice`, `CurrencyExtendedPrice`, `OrderCurrency`, `OrderCurrencyRate`, `ShowHomeCurrencyTotals`, `ShowCurrencyTotals` and `ItemCurrencyTax` carry `show="Multi Currency"`.
- `ShowTotals` carries `show="!Multi Currency"`.

**Not declared at all in AU, so ignored even though the master passes them**
- `FieldTitle:ProformaTitle`
- `FieldTitle:PayButton`
- `ShowPayOnlineButton`
- `PaymentText`
- `DisplayText`
- `FieldTitle:LxWxH`. This one is only read by subCarton, which gets it through the parameter map.

**System values read through `System.getProperty` (Fishbowl sets these from its system properties)**
- `REPORT_DATE_FORMAT`: date pattern.
- `REPORT_DECIMAL_PRICE`, `REPORT_DECIMAL_QTY`, `REPORT_DECIMAL_COST`, `REPORT_DECIMAL_TOTAL`: DecimalFormat patterns.
- `SO Notice`: footer text.
- `Barcodes have DI`.
- `DefaultContainer`: used by subCarton.
- `Boolean.getBoolean("Multi Currency")`.

### 2.4 Main query (verbatim)
```sql
SELECT COMPANY.NAME AS COMPANY, SO.NUM AS SONUM, SO.CUSTOMERCONTACT, SO.CUSTOMERPO, SO.BILLTOADDRESS, SHIPNUMTABLE.SHIPTOADDRESS,
    SO.BILLTONAME, SHIPNUMTABLE.SHIPTONAME, SO.BILLTOCITY, SHIPNUMTABLE.SHIPTOCITY, BILLSTATE.NAME AS BILLTOSTATE, SHIPNUMTABLE.SHIPTOSTATE,
    SO.BILLTOZIP, SHIPNUMTABLE.SHIPTOZIP, BILLCOUNTRY.NAME AS BILLCOUNTRY, SHIPNUMTABLE.SHIPCOUNTRY, SHIPNUMTABLE.SHIPNUM, SUBSTRING(SHIPNUMTABLE.SHIPNUM,2) AS HIPNUM,
    SO.LOCATIONGROUPID, COALESCE(SO.NOTE, '') AS SONOTE, SO.CUSTOMERID, CAST(SHIPNUMTABLE.DATESHIPPED AS DATE) AS DATESHIPPED,
    SO.CURRENCYRATE, CURRENCY.CODE AS CURRENCYCODE, CURRENCY.SYMBOL AS SYMBOL, COMPANY.ABN, ESTIMATEPROPERTY.SYSVALUE AS ESTIMATETITLE,
    BARCODESPROPERTY.SYSVALUE AS BARCODESHAVEDI, FOOTERPROPERTY.SYSVALUE AS SOFOOTER,
    SUM(postsoitem.totalprice) AS SUBTOTAL,
    SUM(ROUND(SOITEM.TAXRATE * postsoitem.totalprice, 2)) AS ORDERTOTALTAX,
    SUM(ROUND(postsoitem.totalprice * SOITEM.TAXRATE / SO.CURRENCYRATE, 2)) AS CURRENCYTAXTOTAL,
    SUM((postsoitem.totalprice / SO.CURRENCYRATE) + (SOITEM.TAXRATE * postsoitem.totalprice) / SO.CURRENCYRATE) AS CURRENCYGRANDTOTAL,
    SUM(postsoitem.totalprice / SO.CURRENCYRATE) AS CURRENCYSUBTOTAL, HOMECURRENCY.SYMBOL AS HOMECURRENCYSYMBOL,
    HOMECURRENCY.CODE AS HOMECURRENCYCODE, ship.id AS SHIPID, so.phone, so.email, COALESCE(contact.datus,'') AS fax,
COALESCE(currency.symbol,homecurrency.symbol,91) AS coalesceSymbol


FROM PostSo
    INNER JOIN PostSoItem ON PostSo.id = PostSoItem.postSoId
    LEFT JOIN ShipItem ON PostSoItem.shipItemId = ShipItem.id
    LEFT JOIN Ship ON ShipItem.shipId = Ship.id
    INNER JOIN SoItem ON PostSoItem.soItemId = SoItem.id
    INNER JOIN So ON SoItem.soId = So.id AND PostSo.soId = So.id
    INNER JOIN Customer ON So.customerId = Customer.id
    LEFT JOIN StateConst BillState ON So.billToStateId = BillState.id
    LEFT JOIN StateConst ShipState ON SHIP.shipToStateId = ShipState.id
    LEFT JOIN CountryConst BillCountry ON So.billToCountryId = BillCountry.id
    LEFT JOIN CountryConst ShipCountry ON SHIP.shipToCountryId = ShipCountry.id
    LEFT JOIN Currency ON Customer.currencyId = Currency.id
    LEFT JOIN Currency AS HomeCurrency ON HomeCurrency.homeCurrency = 1
    INNER JOIN Company ON Company.id = 1
    INNER JOIN (SELECT PostSo.id AS postSoId, Ship.num AS shipNum, Ship.dateShipped, SHIP.SHIPTOADDRESS,
    SHIP.SHIPTONAME, SHIP.SHIPTOCITY, SHIPSTATE.NAME AS SHIPTOSTATE,
    SHIP.SHIPTOZIP, SHIPCOUNTRY.NAME AS SHIPCOUNTRY
                FROM PostSo
                INNER JOIN PostSoItem ON PostSo.id = PostSoItem.postSoId
                INNER JOIN ShipItem ON PostSoItem.shipItemId = ShipItem.id
                INNER JOIN Ship ON ShipItem.shipId = Ship.id
                LEFT JOIN stateconst shipstate ON ship.shiptostateid = shipstate.id
                LEFT JOIN countryconst shipcountry ON shipcountry.id = ship.shiptocountryid
                WHERE PostSo.id = $P!{postSoId} LIMIT 1) AS ShipNumTable ON PostSo.id = ShipNumTable.postSoId
    LEFT OUTER JOIN sysProperties estimateProperty ON estimateProperty.sysKey = 'Estimate Title'
    LEFT OUTER JOIN sysProperties barcodesProperty ON barcodesProperty.sysKey = 'Barcodes have DI'
    LEFT OUTER JOIN sysProperties footerProperty ON footerProperty.sysKey = 'SO Notice'
    LEFT JOIN (SELECT contact.datus, so.id AS soid
			FROM contact
			JOIN postso ON postso.id = $P!{postSoId}
			JOIN so ON so.id = postso.soid
			JOIN customer ON contact.accountid = customer.accountid AND customer.id = so.customerid
			WHERE contact.typeid = 40 AND contact.defaultflag = 1
			LIMIT 1) AS contact ON contact.soid = so.id


WHERE PostSo.id = $P!{postSoId}
  AND SoItem.typeId != 40

GROUP BY Company.name, So.num, So.customerContact, So.customerPo, So.billToAddress,
    So.billToName,  So.billToCity, BillState.name,
    So.billToZip, BillCountry.name, shipnumtable.shiptocity, shipnumtable.shiptozip, shipnumtable.shipcountry, ShipNumTable.shipNum,
    So.locationGroupId, So.note, So.customerId, ShipNumTable.dateShipped,
    So.currencyRate, Currency.code, Currency.symbol, company.abn, EstimateProperty.sysValue,
    BarcodesProperty.sysValue, FooterProperty.sysValue, HomeCurrency.symbol

ORDER BY COALESCE(ship.shiptoname, 'ZZZZZ')
```
The query returns one row per posting. Type 40 lines (subtotal lines) are excluded from the sums.

**Declared fields**

| Field | Type |
|---|---|
| COMPANY, SONUM, CUSTOMERCONTACT, CUSTOMERPO | String |
| BILLTOADDRESS, SHIPTOADDRESS, BILLTONAME, SHIPTONAME | String |
| BILLTOCITY, SHIPTOCITY, BILLTOSTATE, SHIPTOSTATE | String |
| BILLTOZIP, SHIPTOZIP, BILLCOUNTRY, SHIPCOUNTRY | String |
| SHIPNUM, HIPNUM | String |
| LOCATIONGROUPID | Integer |
| SONOTE | String |
| CUSTOMERID | Integer |
| DATESHIPPED | java.sql.Date |
| CURRENCYRATE | Double |
| CURRENCYCODE | String |
| SYMBOL | Integer |
| ABN | String |
| SUBTOTAL | BigDecimal |
| ORDERTOTALTAX, CURRENCYTAXTOTAL, CURRENCYSUBTOTAL, CURRENCYGRANDTOTAL | Double |
| HOMECURRENCYSYMBOL | Integer |
| HOMECURRENCYCODE | String |
| SHIPID | Integer |
| PHONE, EMAIL, FAX | String |
| coalesceSymbol | String |

ESTIMATETITLE, BARCODESHAVEDI and SOFOOTER are selected but not declared, so they are unused.

### 2.5 Variables (main dataset)

| Variable | Expression / meaning |
|---|---|
| CustomerContact | `(CUSTOMERCONTACT non-null && != "") ? "Contact: " + CUSTOMERCONTACT : ""` |
| CustomerPO | `(CUSTOMERPO non-null && != "") ? "PO Number: " + CUSTOMERPO : ""` |
| PriceDecimal / QtyDecimal / CostDecimal / TotalsDecimal | `System.getProperty("REPORT_DECIMAL_PRICE"/"_QTY"/"_COST"/"_TOTAL")` |
| subTotal | `ReportHelperModule.getRoundedMoneyValue($F{SUBTOTAL}.doubleValue(), true)`. Unused. |
| isMultiCurrency | `com.evnt.eve.modules.CurrencyModule.isMultiCurrency()` |
| HCSubTotal | `getRoundedMoneyValue(((CURRENCYSUBTOTAL + CURRENCYTAXTOTAL) * CURRENCYRATE), true) - (CURRENCYTAXTOTAL * CURRENCYRATE)` |
| FooterMessage | `System.getProperty("SO Notice")` |
| lines | Integer. Sum, incrementType Group CustomerAddress, expression `$V{lines}+1`, initial 0. It equals 1 for the (single) row. Read it as "print once". |
| CanDisplaySymbol | `SYMBOL == null \|\| … \|\| new java.awt.Font("Open Sans",PLAIN,1).canDisplay(CurrencySymbolConst.getConstant(SYMBOL).getSymbol().charAt(0))` |
| DateFormat | `System.getProperty("REPORT_DATE_FORMAT")` |
| taxTotal | `$F{ORDERTOTALTAX}` |
| currencySubTotal | `$F{CURRENCYSUBTOTAL}` |
| currencyTaxTotal | `$F{CURRENCYTAXTOTAL}` |
| BarcodesHaveDI | `System.getProperty("Barcodes have DI")` |

**Groups, outer to inner**
1. `CustomerAddress`: expression `new Integer(1)`, so it is a constant and prints once.
2. `CartonInfo`: expression `""`, prints once.
3. `OrderInfo`: expression `$F{SONUM}`, has no bands.

### 2.6 Sub-datasets used by the tables

Column `printWhenExpression`s are evaluated in the **main** report's context. Cell contents are evaluated in the sub-dataset.

#### orderInfo (used by detail bands 2 and 3)

Every table run passes `REPORT_PARAMETERS_MAP` plus `shipID`.

```sql
SELECT so.salesMan AS soSeller, paymentTerms.name AS paymentTerms, fobPoint.name AS fobPoint, shipTerms.name AS shippingTerms, carrier.name AS carrier, so.dateFirstShip AS shipDate, currency.code AS currencyCode, currency.symbol, so.currencyRate, homeCurrency.code AS homeCurrencyCode,
$P!{CustomField:SO1} AS socf1,
	$P!{CustomField:SO2} AS socf2,
	$P!{CustomField:SO3} AS socf3,
	$P!{CustomField:SO4} AS socf4,
	$P!{CustomField:SO5} AS socf5,
	$P!{CustomField:SO6} AS socf6
FROM so
        INNER JOIN paymentTerms ON so.paymentTermsId = paymentTerms.id
        INNER JOIN fobPoint ON so.fobPointId = fobPoint.id
        INNER JOIN shipTerms ON so.shipTermsId = shipTerms.id
        INNER JOIN ship ON ship.orderTypeId = 20 AND ship.soId = so.id
        INNER JOIN carrier ON ship.carrierId = carrier.id
        INNER JOIN customer on so.customerid = customer.id
        LEFT OUTER JOIN currency on customer.currencyid = currency.id
        LEFT OUTER JOIN currency AS homeCurrency ON homeCurrency.homeCurrency = 1

WHERE ship.id = $P{shipID}
```

**Fields**
- SOSELLER, PAYMENTTERMS, FOBPOINT, SHIPPINGTERMS, CARRIER (String)
- SHIPDATE (Timestamp)
- CURRENCYCODE (String)
- SYMBOL (Integer)
- CURRENCYRATE (Double)
- HOMECURRENCYCODE (String)
- socf1..6 (String)

**Variables:** DateFormat, CostDecimal, isMultiCurrency.

#### itemInfo (used by detail band 4)

The table run passes the parameter map plus `module` and `postSoId`.

```sql
SELECT SoItem.soLineItem, SoItemType.name AS soItemType, SoItem.unitPrice + (SoItem.adjustAmount/SoItem.qtyToFulfill) AS unitCost, SoItemUom.code AS uomCode, SoItem.productNum,
    SoItem.customerPartNum, ObjectToObject.recordId2 AS kitParentLine, SoItem.note AS soItemNote, SoItem.description AS productDescription,
    PostSoItem.qty AS qtyToFulfill, ShipItem.id AS shipItemId, TaxRate.code AS itemTaxCode, SoItem.taxRate AS itemTaxRate,
    Currency.code AS currencyCode, Currency.symbol AS Symbol, PostSoItem.totalPrice, COALESCE(so.currencyRate, 1) AS currencyRate,
    (SoItem.unitPrice + (SoItem.adjustAmount/SoItem.qtyToFulfill)) / COALESCE(So.currencyRate, 1) * COALESCE(uomConversion.factor/uomConversion.multiply, 1) AS currencyUnitPrice,
    (PostSoItem.totalPrice / COALESCE(So.currencyRate, 1)) AS currencyTotalExtendedPrice,
    SoItem.taxRate * PostSoItem.totalPrice  AS soItemTaxAmount, SoItem.typeId AS soItemTypeId,
    HomeCurrency.symbol AS homeCurrencySymbol, homecurrency.code AS HOMECURRENCYCODE,
    $P!{CustomField:Item1} AS itemcf1,
    $P!{CustomField:Item2} AS itemcf2,
    $P!{CustomField:Item3} AS itemcf3

FROM So
    INNER JOIN SoItem ON So.id = SoItem.soId
    INNER JOIN TaxRate ON soItem.taxId = TaxRate.id
    INNER JOIN Uom AS SoItemUom ON SoItem.uomId = SoItemUom.id
    INNER JOIN SoItemType ON SoItem.typeId = SoItemType.id
    INNER JOIN PostSoItem ON SoItem.id = PostSoItem.soItemId
    LEFT JOIN ShipItem ON PostSoItem.shipItemId = ShipItem.id
    INNER JOIN Customer ON So.customerId = Customer.id
    LEFT OUTER JOIN UomConversion ON SoItemUom.id = UomConversion.fromUomId AND SoItem.uomId = UomConversion.toUomId
    LEFT OUTER JOIN ObjectToObject ON ObjectToObject.typeId = 30 AND SoItem.id = ObjectToObject.recordId1
    LEFT OUTER JOIN Currency ON Customer.currencyId = Currency.id
    LEFT OUTER JOIN Currency AS HomeCurrency ON HomeCurrency.homeCurrency = 1

WHERE PostSoItem.postSoId = $P{postSoId}

ORDER BY SoItem.soLineItem
```
Item rows **include** type 40 subtotal lines and all posted non-product lines (discounts, misc, shipping and so on).

**Fields**
- SOLINEITEM (Integer)
- SOITEMTYPE (String)
- UNITCOST (Double)
- UOMCODE, PRODUCTNUM, CUSTOMERPARTNUM (String)
- KITPARENTLINE (Integer)
- SOITEMNOTE, PRODUCTDESCRIPTION (String)
- QTYTOFULFILL (Double)
- ITEMTAXCODE (String)
- ITEMTAXRATE (Double)
- CURRENCYCODE (String)
- SYMBOL (Integer)
- TOTALPRICE, CURRENCYUNITPRICE, CURRENCYTOTALEXTENDEDPRICE, CURRENCYRATE (Double)
- SHIPITEMID, SOITEMTYPEID, HOMECURRENCYSYMBOL (Integer)
- HOMECURRENCYCODE (String)
- itemcf1..3 (String)

**Variables (itemInfo)**

PartInfo:
```java
(($F{KITPARENTLINE} == null) ? "" : "     ")
+ ((($F{PRODUCTNUM} == null) || ($F{PRODUCTNUM}.length() < 1)) ? ""
   : (($F{CUSTOMERPARTNUM} == null) || ($F{CUSTOMERPARTNUM}.length() < 1)) ? $F{PRODUCTNUM} : $F{PRODUCTNUM} + " (" + $F{CUSTOMERPARTNUM} + ")")
+ ((PRODUCTNUM null/empty || PRODUCTDESCRIPTION.length()<1) ? "" : " - ")
+ ((PRODUCTDESCRIPTION.length() < 1) ? "" : $F{PRODUCTDESCRIPTION})
```
The kit-component indent is 5 spaces.

extendedPrice:
```java
($F{SOITEMTYPEID}== 30 || $F{SOITEMTYPEID}== 40) ?
    ReportHelperModule.getRoundedMoneyValue($F{TOTALPRICE}, true) :
    ReportHelperModule.getRoundedMoneyValue($F{UNITCOST} * $F{QTYTOFULFILL}, true)
```

TrackingInfo:
```java
(($P{module} == null) || ($F{SHIPITEMID} == null)) ? "" :
  ((ReportHelperModule) $P{module}).getAllShipItemTrackingInfo("ShipItem", $F{SHIPITEMID}.toString())
```

The other variables:

| Variable | Expression / meaning |
|---|---|
| QtyDecimal, PriceDecimal, CostDecimal, TotalsDecimal | System properties, as in the main dataset |
| QtyOrdered | QTYTOFULFILL, or 0 if null. Unused. |
| CanDisplaySymbol | As in the main dataset, using $F{SYMBOL} |
| isMultiCurrency | `CurrencyModule.isMultiCurrency()` |
| Line | Integer, incrementType Group `ITEMID`, initial 0, expression `$F{SOITEMTYPEID} == 80 ? $V{Line} : $V{Line} + 1` |
| TotalQty | Sum of QTYTOFULFILL over all rows |

Group `ITEMID` has expression `$F{SHIPITEMID}`.

#### Table Dataset 1 (the totals table)

Query: `SELECT id FROM company WHERE id = 1`. This exists only to produce one row.

**Parameters**
- homeCurrencySubtotal ← `$V{HCSubTotal}`
- taxTotal ← `$V{taxTotal}`
- currencyTaxTotal ← `$V{currencyTaxTotal}`
- currencyRate ← `$F{CURRENCYRATE}`
- SYMBOL ← `$F{SYMBOL}`
- coalesceSymbol ← `Integer.parseInt($F{coalesceSymbol})`
- SubTotal ← `$V{currencySubTotal}`
- CURRENCYCODE
- HOMECURRENCYCODE
- HOMECURRENCYSYMBOL
- homeCurrencyTaxTotal ← `$V{taxTotal}`
- ShowHomeCurrencyTotals, ShowCurrencyTotals, ShowTotals
- FieldTitle:Total, FieldTitle:Subtotal, FieldTitle:SalesTax

**Variables**
- TotalsDecimal, CostDecimal, PriceDecimal, QtyDecimal
- CanDisplaySymbol (uses `$P{SYMBOL}`)
- isMultiCurrency
- `totalsDecimalNoSymbol = TotalsDecimal.substring(1)`. This drops the first character, which is the currency-symbol placeholder.
- `priceDecimalNoSymbol` (same idea for PriceDecimal)

### 2.7 Bands and elements, top to bottom

#### TITLE (h 50). Error case only.
- printWhen `$F{SONUM}==null`, meaning no rows came back.
- staticText `x0 y0 w552 h50`, colour **#FF0000**, 1.0pt border on all sides, centred horizontally and vertically, Open Sans 9 bold.
- Text: `Cannot create invoice. Order must be shipped and be a Sales Order type.`
- With AllSectionsNoDetail, the page header, group headers and last page footer still render with null fields.

#### PAGE HEADER (h 134, repeats on every page)
Elements are listed in z-order.

| # | Element | x | y | w | h | Font | Align (H/V) | Box | Other | Expression |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | textField (title) | 358 | 0 | 194 | 24 | 17 **bold** (style 24b, size overridden to 17) | Right / Middle | none | stretch, blankWhenNull | `$P{FieldTitle:InvoiceTitle}.equals("%") ? "Tax Invoice" : $P{FieldTitle:InvoiceTitle}` |
| 2 | textField "Date" label | 483 | 34 | 69 | 17 | bold, default size (9) | Center / Middle | border 0.5 all, Opaque grey | Float, markup none | `FieldTitle:Date` "%" gives `"Date"` |
| 3 | textField "Order #" label | 358 | 34 | 125 | 17 | bold, 9 | Center / Middle | border 0.5 all, Opaque grey | Float | `FieldTitle:Order#` "%" gives `"Order #"` |
| 4 | textField date value | 483 | 51 | 69 | 17 | 10 regular | Center / Middle | border 0.5 all | Float, stretch, pattern `$V{DateFormat}` | `$F{DATESHIPPED}` |
| 5 | textField order # value | 358 | 51 | 125 | 17 | 10 **bold** | Center / Middle | border 0.5 all, L/R padding 3 | Float, stretch | see below |
| 6 | frame "Left Logo" | 0 | 0 | 358 | 134 | | | | printWhen `$P{cbLogoAlignment}.equals("left")` | contains 6a–6c |
| 6a | company address | 75 | 53 | 283 | 55 | 9 (default), markup **styled** | Left / Top | leftPadding 3 | Float, stretch; printWhen `$P{module} != null && $P{ShowCompanyAddress}` | `"<b>" + "ABN: " + "</b>" + $F{ABN} + "\n" + ((ReportHelperModule)$P{module}).getCompanyReportAddress($F{LOCATIONGROUPID}, $P{ShowCountry})` |
| 6b | company name | 75 | 33 | 283 | 20 | 14 bold | Left / Top | leftPadding 3 | stretch; printWhen `$P{ShowCompanyName}` | `$F{COMPANY}` |
| 6c | image (logo) | 0 | 0 | 75 | 134 | | Center / Middle, scale RetainShape | Opaque white | isUsingCache false; printWhen `module != null` | `ImageUtil.decodeImage(((ReportHelperModule)$P{module}).getImageData("Company", 1, true))` |
| 7 | frame "Top Logo" | 0 | 0 | 358 | 134 | | | | printWhen `$P{cbLogoAlignment}.equals("top")` | contains 7a–7c |
| 7a | company address | 0 | 60 | 358 | 55 | 9, styled | Left / Top | bottomPadding 3 | Float, stretch; same printWhen as 6a | same expression as 6a |
| 7b | company name | 0 | 40 | 358 | 20 | 14 bold | Left / **Middle** | none | printWhen ShowCompanyName | `$F{COMPANY}` |
| 7c | image (logo) | 0 | 0 | 356 | 40 | | Left / **Bottom**, RetainShape | | isUsingCache true; printWhen module != null | same as 6c |
| 8 | barcode (barbecue) | 358 | 73 | 194 | 47 | | centred (Barcode style) | | Float; printWhen `$P{ShowBarcode}`; evaluationTime Report | Code128B, drawText **false**, checksumRequired false, barHeight 50, code `$F{SHIPNUM}` |

Expression for element 5 (verbatim):
```java
$P{cbOrderNumber}.equals("Ship") ?
    ($V{BarcodesHaveDI} == null || $V{BarcodesHaveDI}.equals("true") ? $F{SHIPNUM} : $F{HIPNUM}) :
    ($P{cbOrderNumber}.equals("SO") ?
        $F{SONUM} :
        ($F{CUSTOMERPO} == null || $F{CUSTOMERPO}.length() < 1 ?
           $F{SONUM} :
           $F{CUSTOMERPO})
   )
```
- HIPNUM is SHIPNUM with its first character removed.
- The barcode always encodes the full SHIPNUM.

#### GROUP CustomerAddress header (h 77, prints once, grows with content)
Elements are listed in z-order.

| # | Element | x | y | w | h | Font | Align | Box | Other | Expression |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Contact/PO box (textField-5) | 281 | 61 | 271 | 11 | 9 (default), not italic | Left / Top | padding 3 all; borders: top 0, left 0.5, bottom 0.5, right 0.5 | **Float**, stretch, blankWhenNull | `(CustomerContact=="" && CustomerPO=="") ? "" : CustomerContact + ((both non-empty) ? "\n" : "") + CustomerPO` |
| 2 | Ship To body | 281 | 17 | 271 | 44 | 10 | Left / Top | padding 3 all; borders: top 0.5, left 0.5, bottom **0**, right 0.5 | stretch, blankWhenNull | see below |
| 3 | spacer staticText | 271 | 0 | 10 | 77 | 10 | | | empty text | |
| 4 | "Ship To" header | 281 | 0 | 271 | 17 | 10 bold | Left / **Bottom** | Opaque grey; border 0.5 all; leftPadding 3 | markup none | `FieldTitle:ShipTo` "%" gives `"Ship To:"` |
| 5 | "Bill To" header | 0 | 0 | 271 | 17 | 10 bold | Left / Bottom | Opaque grey; border 0.5 all; leftPadding 3 | | `FieldTitle:BillTo` "%" gives `"Bill To:"` |
| 6 | Bill To body | 0 | 17 | 271 | 55 | 10 | Left / Top | padding 3 all; border 0.5 all | stretch, blankWhenNull | see below |

Ship To body expression:
```java
($F{SHIPTONAME} == null ? "" : $F{SHIPTONAME} + "\n") +
($F{SHIPTOADDRESS} == null ? "" : $F{SHIPTOADDRESS} + "\n") +
($F{SHIPTOCITY} == null ? "" : $F{SHIPTOCITY}) + ($F{SHIPTOSTATE} == null ? "  " : ", " + $F{SHIPTOSTATE}) + ($F{SHIPTOZIP} == null ? "" : "  " +  $F{SHIPTOZIP}) +
($P{ShowCountry}.booleanValue() ? "\n" + ($F{SHIPCOUNTRY}==null ? "" : $F{SHIPCOUNTRY}) : "")
```

Bill To body expression (verbatim; note there are no null guards on phone, email, fax or country):
```java
$F{BILLTONAME} + "\n" +
($F{BILLTOADDRESS} != null ? $F{BILLTOADDRESS} + "\n" : "") +
($F{BILLTOCITY} != null ? $F{BILLTOCITY} + ", " : "") +
	($F{BILLTOSTATE} != null ? $F{BILLTOSTATE} + "  " : "  ") +
	($F{BILLTOZIP} != null ? $F{BILLTOZIP} : "") +
($P{ShowCountry} ? "\n" + $F{BILLCOUNTRY} : "") +
($P{ShowBillToPhone} ? "\n" + "Phone: " + $F{PHONE} : "") +
($P{ShowBillToEmail} ? "\n" + "Email: " + $F{EMAIL} : "") +
($P{ShowBillToFax} ? "\n" + "Fax: " + $F{FAX} : "")
```

Layout notes:
- The left and right columns stretch independently.
- With the default options, Bill To has six or more lines (name, address, city line, Phone, Email, Fax). That is about 88pt, so it usually grows beyond 55 and the band grows to match.
- The Ship To side does **not** grow to match. Its boxes stay shorter, ending at 72 plus any growth of its own.
- The Contact/PO box floats down if Ship To body grows. It is always drawn, closing the Ship To box, even when its text is empty.

#### GROUP CartonInfo header (h 19)
- Band printWhen `$P{ShowCartonInfo}`.
- One subreport: `x0 y0 w552 h14`, Float.
- Parameters: `REPORT_PARAMETERS_MAP` plus `ShipID=$P{shipID}`.
- File: `"../Ship/subCarton.jasper"` (hard-coded path). See §3.

#### DETAIL band 1: SO notes (h 19)
- Band printWhen: `$V{lines} == 1 && !$F{SONOTE}.isEmpty() && $P{ShowNote}`.
- staticText "SO Notes:" at `x1 y0 w49 h14`, 10 bold, markup none. printWhen `!($F{SONOTE}.equals(""))`.
- textField at `x51 y0 w502 h14`, Float, stretch, blankWhenNull, padding left 3 and right 3, 10 regular, left/top.
  - Expression: `$F{SONOTE}`. Same printWhen as the label.
  - It extends 1pt past the 552 column.
- There is a 5pt gap after the text.

#### DETAIL band 2: order info table (h 30)
- Band printWhen `$V{lines} == 1`.
- Table at `x0 y0 w552 h30`, Float, dataset orderInfo.
- Each column is 92 wide.
  - Header cell: h16. The textField is 92×16, Opaque grey, 10 bold, centred, markup none. The cell box has border 0.5 on all sides.
  - Detail cell: h14. The textField is 92×14, 10 regular, centred horizontally and vertically, stretch, blankWhenNull. The cell box has top 0, left 0.5, bottom 0.5, right 0.5.
- Hidden columns collapse to the left.

| Col | Column printWhen (main ctx) | Header default | Detail expression |
|---|---|---|---|
| 1 | `$P{SalesPerson}` | "Sales Person" | `$F{SOSELLER}` (so.salesMan) |
| 2 | `$P{PaymentTerms}` | "Payment Terms" | `$F{PAYMENTTERMS}` |
| 3 | `$P{FOBPoint}` | "FOB Point" | `$F{FOBPOINT}` |
| 4 | `$P{ShippingTerms}` | "Shipping Terms" | `$F{SHIPPINGTERMS}` |
| 5 | `$P{ShipVia}` | "Carrier" | `$F{CARRIER}` (the shipment's carrier) |
| 6 | `$P{ReqShipDate}` | "Date Scheduled" | `$F{SHIPDATE}` (so.dateFirstShip), pattern `$V{DateFormat}` |
| 7 | `$P{OrderCurrency}` | "Order Currency" | `$V{isMultiCurrency} ? ($F{SYMBOL} == null ? $F{HOMECURRENCYCODE} : $F{CURRENCYCODE}) : "USD"`. Note: hard-coded USD. |
| 8 | `$P{OrderCurrencyRate}` | "Currency Rate" | `$F{CURRENCYRATE}`, pattern `" #,##0.0#######"` (leading space) |

- Each header text is `FieldTitle:X.equals("%") ? default : FieldTitle:X`.
- With the defaults, six columns × 92 = 552 exactly. Turning on columns 7 and 8 makes the table 736 wide, which overflows the page.

#### DETAIL band 3: SO custom fields table (h 40)
- Band printWhen `$P{ShowSOCustomFields}` (default false).
- Table at `x0 y10 w552 h30`, dataset orderInfo again.
- Six columns, each 92 wide.
  - Header h14: Opaque grey, 10 bold, centred horizontally and vertically, border 0.5 all, blankWhenNull.
  - Detail h14: 10 regular, centred horizontally with default top alignment, border 0.5 all, stretch, blankWhenNull.
- Column N has printWhen `$P{ShowCfSO N}` (default true).
- Header text: `$P{FieldTitle:SOcfN}.equals("%") ? "Custom Field N" : $P{FieldTitle:SOcfN}`.
- Detail: `$F{socfN}`.

#### DETAIL band 4: items table (h 46)
- Table at `x0 y14 w552 h32`, Float, dataset itemInfo. There is a 14pt gap above it.
- Header row h30. Each header textField is `y0 h28`, Opaque grey, 10 bold, vertical **Bottom**, markup none, stretchType RelativeToBandHeight.
  - The header cell box has bottomPen 0.5 black at y=30, so there is a 2pt white strip under the grey.
  - Most header cells also have left and right 0.5 **white** pens as column separators.
- Detail row h13, all style Zebra, 9pt, vertical Top, stretch-with-overflow, stretchType RelativeToBandHeight, blankWhenNull. Detail cells have **no borders**.
- Footer row h13. Only the Qty column has content, but the row is always present.

| # | Column printWhen | w | Header text (default) and header align | Detail align / padding | Detail expression |
|---|---|---|---|---|---|
| 1 | `$P{ItemLineNumber}` | 30 | "Item #", Center, L/R padding 3. Box: bottom 0.5, right 0.5 white. | Center | `$P{IncludeKitsInItemNumbering} ? $V{REPORT_COUNT} : $F{SOITEMTYPEID} == 80 ? "" : $V{Line}` |
| 2 | `$P{Type}` | 35 | "Type", Center | Center | `$F{SOITEMTYPE}.startsWith("Discount") ? "Discount" : $F{SOITEMTYPE}` |
| 3 | `$P{ShowCfItem1}` | 90 | "Item CF 1", Center (box bottom 0.5 only) | Center, L/R pad 3 | `$F{itemcf1}` |
| 4 | `$P{ItemNumberAndDescription}` | 219 | Left, leftPad 3; see header logic below | Left, leftPad 3 | `$V{PartInfo} + (TrackingInfo empty ? "" : "\n  " + TrackingInfo) + (SOITEMNOTE null/"" ? "" : "\n  " + SOITEMNOTE)` |
| 5 | `$P{ItemNumber}` | 69 | "Item", Left, leftPad 3 | Left, leftPad 3 | `(KITPARENTLINE==null ? "" : "     ") + (PRODUCTNUM null/empty ? "" : CUSTOMERPARTNUM null/empty ? PRODUCTNUM : PRODUCTNUM + " (" + CUSTOMERPARTNUM + ")")` |
| 6 | `$P{ItemDescription}` | 150 | "Description", Left, leftPad 3 | Left, leftPad 3 | `$F{PRODUCTDESCRIPTION} + (TrackingInfo empty ? "" : "\n  " + TrackingInfo) + (SOITEMNOTE null/"" ? "" : "\n  " + SOITEMNOTE)` |
| 7 | `$P{ShowCfItem2}` | 90 | "Item CF 2", Center | Center, L/R pad 3 | `$F{itemcf2}` |
| 8 | `$P{TaxCode}` | 27 | "Tax Code", Center (wraps to 2 lines) | Left, leftPad 3 | `$F{ITEMTAXCODE}` |
| 9 | `$P{TaxAmount}` | 52 | "Tax Amount", Center | Right, rightPad 3; pattern `$V{PriceDecimal}` | `isMC ? CurrencySymbolConst.getFormattedCurrency(HOMECURRENCYSYMBOL, QTYTOFULFILL*UNITCOST*ITEMTAXRATE, PriceDecimal) : QTYTOFULFILL*UNITCOST*ITEMTAXRATE` |
| 10 | `$P{ItemCurrencyTax}` | 52 | `(SYMBOL==null \|\| CURRENCYCODE==null) ? "Tax\nAmount" : CURRENCYCODE + "\nTax Amount"`, Center | Right, rightPad 3 | `SYMBOL==null ? fmt(HOMECURRENCYSYMBOL, tax/CURRENCYRATE, PriceDecimal) : CanDisplaySymbol ? fmt(SYMBOL, tax/CURRENCYRATE, PriceDecimal) : new DecimalFormat(PriceDecimal).format(tax/CURRENCYRATE)`, where tax = QTY×UNITCOST×ITEMTAXRATE |
| 11 | `$P{UnitPrice}` | 65 | "Unit Price", **Right**, rightPad 3 | Right, rightPad 3; pattern PriceDecimal | `isMC ? fmt(HOMECURRENCYSYMBOL, type==30 ? TOTALPRICE : UNITCOST, PriceDecimal) : (type==30 ? TOTALPRICE : UNITCOST)` |
| 12 | `$P{CurrencyUnitPrice}` | 65 | `(SYMBOL==null\|\|CODE==null) ? UnitPriceTitle : CURRENCYCODE + "\n" + UnitPriceTitle`, Right, rightPad 3, stretch | Right, rightPad 3; pattern PriceDecimal | `isMC ? (SYMBOL==null ? fmt(HOME, type==30 ? CURRENCYTOTALEXTENDEDPRICE : CURRENCYUNITPRICE) : fmt(SYMBOL, same)) : (type==30 ? TOTALPRICE : UNITCOST)` |
| 13 | `$P{QtyShipped}` | 60 | "Qty Shipped", Center | two fields (below) | qty: `$F{QTYTOFULFILL}`; UOM: `$F{UOMCODE}` |
| 14 | `$P{ExtendedPrice}` | 65 | "Extended Price", Right, rightPad 3 | Right, rightPad 3; pattern `$V{TotalsDecimal}` | `isMC ? fmt(HOMECURRENCYSYMBOL, $V{extendedPrice}, TotalsDecimal) : $V{extendedPrice}` |
| 15 | `$P{CurrencyExtendedPrice}` | 65 | `(SYMBOL==null\|\|CODE==null) ? (title or "Extended\nPrice") : CURRENCYCODE + "\n" + (title or "Extended\nPrice")`, **Center**, rightPad 3; box right pen 0 | Right, rightPad 3; pattern TotalsDecimal | `isMC ? (SYMBOL==null ? fmt(HOME, CURRENCYTOTALEXTENDEDPRICE, TotalsDecimal) : fmt(SYMBOL, CURRENCYTOTALEXTENDEDPRICE, TotalsDecimal)) : $V{extendedPrice}` |
| 16 | `$P{ShowCfItem3}` | 90 | "Item CF 3", Center | Center, L/R pad 3 | `$F{itemcf3}` |

Notes on the items table:
- `fmt(...)` means `com.fbi.sdk.constants.setup.CurrencySymbolConst.getFormattedCurrency(symbolId, value, pattern)`.
- "type" means `$F{SOITEMTYPEID}`.
- Column 13 detail layout: qty at `x0 w36`, right-aligned, pattern `$V{QtyDecimal}`. UOM at `x36 w24`, left-aligned, leftPadding 2.
- Column 13 footer (h13): `x0 w36 h13`, 9 bold, right-aligned, 0.5 top border, pattern QtyDecimal, value `$V{TotalQty}`. printWhen `$P{ShowTotalQty}`.
- Column 4 header logic:

```java
$P{FieldTitle:Description}.equals("%") && $P{FieldTitle:Item}.equals("%") ? "Item / Description"
  : ($P{FieldTitle:Item}.equals("%") ? "Item" : $P{FieldTitle:Item}) + " / " + ($P{FieldTitle:Description}.equals("%") ? "Description" : $P{FieldTitle:Description})
```

**Default visible layout, not multi-currency**

| Column | x | w |
|---|---|---|
| Item # | 0 | 30 |
| Type | 30 | 35 |
| Item | 65 | 69 |
| Description | 134 | 150 |
| Tax Code | 284 | 27 |
| Tax Amount | 311 | 52 |
| Unit Price | 363 | 65 |
| Qty | 428 | 60 (number 428–464, UOM 464–488) |
| Extended Price | 488 | 65 (ends at **553**, 1pt past the column) |

With multi-currency on, Currency Unit Price and Currency Extended Price take the same slots as Unit Price and Extended Price. Hidden columns are removed and the remaining columns pack to the left. Nothing stretches to fill the width.

#### LAST PAGE FOOTER (h 133)
- Last page only, pinned to page y 605–738.
- There is **no normal page footer** in the sub.

| # | Element | x | y | w | h | Font | Align | Other | Expression / content |
|---|---|---|---|---|---|---|---|---|---|
| 1 | textField (footer text) | 0 | 12 | 293 | 121 | 8 | Left / **Bottom**, rightPadding 3 | stretch, blankWhenNull; printWhen `!$P{ShowDeliverySignature} && $P{Column:CustomFooterText}` | `($V{FooterMessage} == null ? "Approval:_________________________     Date:_____________" : $V{FooterMessage})`. That is 25 underscores, 5 spaces, then 13 underscores. |
| 2 | image (signature) | 50 | 12 | 243 | 69 | | Left / Middle | printWhen `$P{ShowDeliverySignature}` | `ImageUtil.decodeImage(((ReportHelperModule)$P{module}).getImageData("Ship", $F{SHIPID}, true))` |
| 3 | staticText "Received By:" | 0 | 70 | 97 | 14 | 10 | Right, rightPadding 5 | FixRelativeToBottom; printWhen ShowDeliverySignature | `Received By:` (overlaps the signature image's lower-left area) |
| 4 | totals table | 293 | 48 | 259 | 85 | | | FixRelativeToBottom; printWhen `$V{isMultiCurrency} ? $P{ShowHomeCurrencyTotals} \|\| $P{ShowCurrencyTotals} : $P{ShowTotals}` | dataset "Table Dataset 1" |

**Totals table structure**

The table has three rows, each 14 tall:
- Row y0: Subtotal, Opaque grey.
- Row y14: tax, Opaque **#FFFFFF**.
- Row y28: Total, Opaque grey.

Every cell is 10 **bold**, right-aligned, vertically centred, with rightPadding 3 and 1.0pt **white** left/right pens as separators. There are no black lines except the bottom 0.5 under the optional currency-code header row.

Columns, left to right:

| Col | w | Column printWhen | Content |
|---|---|---|---|
| A (spacer) | 45 | `!$P{ShowHomeCurrencyTotals} \|\| !$V{isMultiCurrency} \|\| $F{CURRENCYCODE} == null` | empty, h42 |
| B (spacer) | 95 | `ShowHomeCurrencyTotals && isMC && CURRENCYCODE != null && !ShowCurrencyTotals` | empty |
| C (labels) | 69 | always | Subtotal label, tax label, Total label (below) |
| D (order-currency values) | 145 | same as A | Subtotal, tax, total values (below) |
| E (currency column) | 95 | `ShowHomeCurrencyTotals && isMC && CURRENCYCODE != null && ShowCurrencyTotals` | header row (h14, grey, bottom 0.5) shows `$P{CURRENCYCODE}`; values below |
| F (home column) | 95 | `ShowHomeCurrencyTotals && isMC && CURRENCYCODE != null` | header shows `$P{HOMECURRENCYCODE}`; values below |

Column C labels:
- y0: `FieldTitle:Subtotal` "%" gives `"Subtotal:"`.
- y14: `$P{FieldTitle:SalesTax}.equals("%") ? com.evnt.eve.modules.AccountingModule.isAu() ? "GST:" : "Sales Tax:" : $P{FieldTitle:SalesTax}`.
- y28: `"Total:"`.

Column D values, where `F(v) = CanDisplaySymbol ? fmt(coalesceSymbol, v, TotalsDecimal) : new DecimalFormat(totalsDecimalNoSymbol).format(v)`:
- y0: `F(SubTotal)`
- y14: `F(currencyTaxTotal)`
- y28: `F(SubTotal + currencyTaxTotal)`

Column E values, using coalesceSymbol:
- y0: SubTotal
- y14: currencyTaxTotal
- y28: **SubTotal + taxTotal**. This is a bug: it adds the home-currency tax.

Column F values, using HOMECURRENCYSYMBOL:
- y0: homeCurrencySubtotal
- y14: homeCurrencyTaxTotal
- y28: homeCurrencySubtotal + homeCurrencyTaxTotal

The three possible layouts each total 259 wide, so the table is always flush with the right edge (x 552):
- Default: A + C + D = 45 + 69 + 145.
- Home-currency and currency totals both on: C + E + F.
- Home-currency totals only: B + C + F.

There is a 14pt header row only when E or F is shown. On the page, the totals start at y 653 (605 + 48).

---

## 3. `subCarton.jrxml`

### 3.1 Page and parameters
- Page width 552, height 792. All margins 0.
- Default style: the last `isDefault` is "note", 9pt.
- Parameters:
  - `ShipID` (String, default "%")
  - `ISSUBREPORTONLY`
  - `FieldTitle:CartonInfo`, `Carton#`, `Weight`, `Tracking#`, `TotalWeight`, `Cartoncount`, `LxWxH`

### 3.2 Query (verbatim)
```sql
SELECT
    SHIPCARTON.ID AS SHIPCARTONID,
    SHIPCARTON.CARTONNUM AS CARTONNUM,
    SHIPCARTON.TRACKINGNUM AS TRACKINGNUMBER,
    SHIPCARTON.FREIGHTWEIGHT AS WEIGHT,
    CARRIER.NAME AS CARRIERNAME,
    COALESCE(WEIGHTUOM.CODE, 'lbs') AS WEIGHTUOMCODE,
    COALESCE(SHIPCARTON.LEN,'') AS LEN,
    COALESCE(SHIPCARTON.WIDTH,'') AS WIDTH,
    COALESCE(SHIPCARTON.HEIGHT,'') AS HEIGHT,
    COALESCE(SHIPCARTON.SIZEUOM,'') AS UOM

FROM
    shipcarton
    INNER JOIN carrier ON shipcarton.carrierid = carrier.id
    LEFT OUTER JOIN sysProperties ON sysProperties.sysKey = 'Default Weight UomId'
    LEFT OUTER JOIN uom weightUom ON sysProperties.sysValue = weightUom.id

WHERE shipcarton.shipid = $P{ShipID}

ORDER BY shipcarton.cartonnum
```

**Fields**
- SHIPCARTONID, CARTONNUM (Integer)
- TRACKINGNUMBER (String)
- WEIGHT (Double)
- CARRIERNAME, WEIGHTUOMCODE, UOM (String)
- LEN, WIDTH, HEIGHT (Double)

**Variables**
- `totalWeight`: sum of WEIGHT. This is a running total during the detail rows.
- `totalCount`: count of SHIPCARTONID.
- PriceDecimal, QtyDecimal, CostDecimal.

`DefaultContainer` below means `System.getProperty("DefaultContainer","Carton")`.

### 3.3 Layout

**Title (h17)**
- textField `x0 y0 w552 h17`, 12 bold, leftPadding 3, top-aligned.
- Expression: `FieldTitle:CartonInfo "%" ? DefaultContainer + " Info" : title`.

**Column header (h14, splitType Prevent)**
- All grey Opaque, bold.

| Header | x | w | Default text | Align / box |
|---|---|---|---|---|
| Carton # | 0 | 120 | `DefaultContainer + " #"` | style 10b, Left/Top, leftPad 3, white 1.0 left/right pens, bottom 0.5 |
| Tracking # | 387 | 165 | "Tracking #" | Right/Top, rightPad 3, white 1.0 left/right pens, bottom 0.5 |
| Weight | 120 | 113 | "Weight" | 10 bold, vertical Bottom, leftPad 3, bottom 0.5 |
| L x W x H | 233 | 154 | "L x W x H" | 10 bold, Bottom, leftPad 3, bottom 0.5 |

**Detail (h15, splitType Prevent)**
- Every field is `y1 h14`, 10pt, padding L/R 3, top-aligned, with a **0.25 black bottom border**.

| Field | x | w | Align | printWhen | Expression / notes |
|---|---|---|---|---|---|
| USPS tracking | 368 | 184 | Right | `TRACKINGNUMBER.trim().length()>0 && CARRIERNAME.contains("USPS")` | Style Zebra, mode Opaque, colour #000099, underline. Link: `http://trkcnfrm1.smi.usps.com/PTSInternetWeb/InterLabelInquiry.do?strOrigTrackNum=` + tracking |
| UPS tracking | 387 | 165 | Right | `…contains("UPS")` | #000099, underline. Link: `http://wwwapps.ups.com/WebTracking/processInputRequest?HTMLVersion=5.0&tracknums_displayed=1&TypeOfInquiryNumber=T&loc=en_US&InquiryNumber1=` + tracking + `&track.x=Track` |
| FedEx tracking | 387 | 165 | Right | `…contains("Fed")` | #000099, underline. Link: `https://www.fedex.com/fedextrack/?trknbr=` + tracking |
| Other carrier tracking | 387 | 165 | Right | non-empty and not Fed/USPS/UPS | black, no underline, no link |
| Carton # | 0 | 120 | Left | | `$F{CARTONNUM}.toString()`, stretchType RelativeToTallestObject |
| Weight | 120 | 113 | Left | | `totalWeight > 0 ? WEIGHT + " " + WEIGHTUOMCODE : ""`. Uses Java Double.toString, e.g. "5.0 lbs". The `#,##0.#####` pattern is ignored because the value is a String. |
| L x W x H | 233 | 154 | Left | | `DecimalFormat(QtyDecimal).format(LEN) + " " + UOM + " x " + …WIDTH + " " + UOM + " x " + …HEIGHT + " " + UOM`, stretchType RelativeToTallestObject |

- All three carrier links have the tooltip `"Track My " + DefaultContainer`.
- Note that "UPS" is also contained in "USPS", so a USPS carrier matches both the USPS and UPS fields and both print, overlapping.

**Summary (h14)**
- Label `x0 y0 w145 h14`, Right, Middle, 10 bold: `FieldTitle:TotalWeight "%" ? "Total Weight:" : title`. It always prints.
- Value `x145 y0 w242 h14`, Middle, 10 bold, leftPad 3: `$V{totalWeight} + " " + $F{WEIGHTUOMCODE}`. printWhen `totalWeight > 0`.
- Carton count `x387 y0 w165 h14`, Right, top, 10 bold, rightPad 3, evaluationTime Report:
  `$P{FieldTitle:TotalWeight}.equals("%") ? DefaultContainer + " " + "Count: " + $V{totalCount} : $P{FieldTitle:TotalWeight} + ": " + $V{totalCount}`
  - This is a bug: it uses the TotalWeight title. The SpecialCharacters copy fixes it to use Cartoncount.

---

## 4. Differences in the other variants

### 4.1 `subShippingInvoice_CA` compared with AU
- **Item numbering group.** itemInfo also selects `postsoitem.id AS postsoitemid` (Integer field). Group `ITEMID` uses `$F{postsoitemid}` instead of SHIPITEMID. This is the fix for rows with a null ShipItem.
- The empty `OrderInfo` group is not present.
- **Default title** is `"Invoice"` (not "Tax Invoice").
- **Company address, Left Logo frame:**
  `$F{ABN} == null ? "" : "<b>" + "GST/HST: " + "</b>" + $F{ABN} + "\n" + getCompanyReportAddress(...)`
  Because of Java's ternary precedence, **when ABN is null the entire address block is blank.**
- **Company address, Top Logo frame:** the same, but the prefix is a plain `"GST/HST: "` with no `<b>`.
- **SO Notes:** label at `x0 w49`; text at `x49 w503`, leftPadding 3 only.
- **Order info table:** the Order Currency and Currency Rate detail fonts have no size, so they render at 9pt.
- **Items table:**

| Column | CA width | Other CA changes |
|---|---|---|
| Type | 44 | detail L/R padding 3 |
| Item/Description | 216 | |
| Item | 66 | |
| Tax Code | 29 | detail **centred**, no padding |
| Tax Amount | 43 | detail has no right padding; printWhen below |
| Currency Tax | 43 | no right padding; printWhen below |
| Unit Price, Currency Unit Price, Extended Price, Currency Extended Price | unchanged | detail right padding removed |
| Currency Extended Price header | | right-aligned |
| Qty | 62 | number `x0 w38`, UOM `x38 w24`; footer row **h14** with total at `y1 w38`; qty detail has no topPadding box |

  Tax Amount printWhen:
  ```java
  com.evnt.eve.modules.CurrencyModule.isMultiCurrency() == false ||
  (com.evnt.eve.modules.CurrencyModule.isMultiCurrency() && $P{TaxAmount} && $F{HOMECURRENCYCODE}.equals($F{CURRENCYCODE}))
  ```
  When multi-currency is off, the TaxAmount option is ignored and the column always shows.

  Currency Tax printWhen:
  ```java
  com.evnt.eve.modules.CurrencyModule.isMultiCurrency() && $P{ItemCurrencyTax} && ($F{HOMECURRENCYCODE} != $F{CURRENCYCODE})
  ```
  The `!=` here compares string references, not values.

  The default non-multi-currency total width is 554.
- The query, totals, footer and tax label are the same as AU. The tax label shows "Sales Tax:" because `AccountingModule.isAu()` is false.
- No Pay Online button.

### 4.2 `subShippingInvoice_US` compared with AU
**Tax model**
- There are no `TaxCode`, `TaxAmount` or `ItemCurrencyTax` parameters or columns, and no `FieldTitle:TaxCode/TaxAmount`.
- itemInfo has no TaxRate join, no ITEMTAXCODE/ITEMTAXRATE, and adds `postsoitemid`, with group ITEMID on postsoitemid as in CA.
- Tax in the main query is SO-level:
  ```sql
  SUM(postsoitem.totalprice) AS SUBTOTAL,
  SUM((CASE SOITEM.TAXABLEFLAG WHEN 1 THEN SO.TAXRATE ELSE 0 END) * POSTSOITEM.TOTALPRICE) AS TAXRATE,
  SUM((CASE SOITEM.TAXABLEFLAG WHEN 1 THEN POSTSOITEM.TOTALPRICE * COALESCE(SO.TAXRATE, 0) / SO.CURRENCYRATE ELSE 0.0 END)) AS CURRENCYTAXTOTAL,
  SUM((postsoitem.totalprice) / SO.CURRENCYRATE) AS CURRENCYSUBTOTAL,
  SUM(((postsoitem.totalprice) / SO.CURRENCYRATE) + ((CASE SOITEM.TAXABLEFLAG WHEN 1 THEN SO.TAXRATE ELSE 0 END) * (postsoitem.totalprice)) / SO.CURRENCYRATE) AS CURRENCYGRANDTOTAL,
  ... , so.paymentlink
  ```
  - Tax is not rounded per line.
  - The query has no `COMPANY.ABN`, no sysProperties joins, and no ShipState/ShipCountry joins on the outer Ship.
  - It groups by `Company.id, So.taxRate, HomeCurrency.symbol, HomeCurrency.code` and orders by `COALESCE(ship.shiptoname, 'ZZZZ')`.
  - Fields: `TAXRATE` replaces ORDERTOTALTAX; ABN is gone; `paymentlink` (String) is added.
- Variables are rounded:
  - `taxTotal = getRoundedMoneyValue($F{TAXRATE}, true)`
  - `currencySubTotal = getRoundedMoneyValue(CURRENCYSUBTOTAL, true)`
  - `currencyTaxTotal = getRoundedMoneyValue(CURRENCYTAXTOTAL, true)`

**Header and address**
- There is no ABN line. The company address is just `getCompanyReportAddress(...)` with no styled markup.
- Title is `"Invoice"`.
- There is no 10pt spacer static between Bill To and Ship To. This is cosmetic.

**Carton subreport**
- The element is 553 wide.
- The path is `$P{path} + "subCarton.jasper"`.

**Parameters**
- `ShowTotals` default is `true`, with no "show" property.
- The currency parameters have no "show" property.
- `ShowCfShip1` is added but unused.
- Pay-button parameters are added: `FieldTitle:PayButton`, `ShowPayOnlineButton` [true], `PaymentText`, `DisplayText` [true].
- In itemInfo, `ItemNumber`/`ItemDescription` are renamed to `colItemNumber`/`colItemDescription`. These are unused; the columns still test the main `$P{ItemNumber}`/`$P{ItemDescription}`.
- orderInfo gains an unused `ShowSOCustomFields`.

**SO Notes:** label at `x0 w50`; text at `x50 w503`, padding left/right 3.

**Order info table:** the Date Scheduled, Order Currency and Currency Rate header and detail fonts have no size, so they render at 9pt.

**Items table widths**

| Column | US width |
|---|---|
| Item # | 32 |
| Type | 45 |
| Item/Description | 263 |
| Item | 100 |
| Description | 163 |
| Unit Price | 71 |
| Currency Unit Price | 71 |
| Qty | 71 (number `x0 w41`, UOM `x41 w30`, footer total `w41`) |
| Extended Price | 72 |
| Currency Extended Price | 71 (header right-aligned) |

- The default non-multi-currency total width is 554.
- The money detail cells have no right padding (`topPadding 0` only).
- The Item #, Type, Item/Description, Item, Description and money detail cells have **no stretchType**. That means zebra fills do not stretch to the row height when another cell in the row wraps.

**Last page footer**
- Footer text uses `markup="styled"`.
- The totals table is at **`x293 y31 w259 h56`**, which on the page is y 636.
- The **Pay Online frame** is at `x293 y87 w259 h46`. printWhen:
  `$P{ShowPayOnlineButton} && !$F{paymentlink}.equals(null) && !$F{paymentlink}.equals("")`
  - Rounded rectangle: `x147 y0 w112 h26`, radius 10, fill **#137FFD**, 1.0pt border **#0265D9**. Same printWhen.
  - Link text: `x147 y0 w112 h26`, colour #FFFFFF, Open Sans 16 regular, centred horizontally and vertically, no padding. Text: `FieldTitle:PayButton "%" ? "Pay Online" : title`. Hyperlink and anchor are `$F{paymentlink}`.
  - Caption: `x0 y26 w259 h20`, 7pt, right-aligned, styled markup, printWhen `$P{DisplayText}`. Text: `$P{PaymentText}.equals("%") ? "The payment portal will show the total amount for the order.\n" + "For partial shipments, <b>only the invoice total is due.</b> Thank you!" : $P{PaymentText}`.
- The tax label expression is the same, so it shows "Sales Tax:".

### 4.3 ProForma compared with Invoice (common to all three editions)
- **When it is used:** shipment status is not 30. It works from live ship data, not the posted (PostSo) record.
- **Parameter:** `FieldTitle:ProformaTitle` replaces `FieldTitle:InvoiceTitle`.
  - Default title: AU **"Tax Proforma"**, CA "Proforma", US "Proforma".
- **itemInfo query** (AU verbatim; CA is the same):
  ```sql
  SELECT SoItem.soLineItem, SoItemType.name AS soItemType, SoItem.unitPrice + (SoItem.adjustAmount/SoItem.qtyToFulfill) AS unitCost, SoItemUom.code AS uomCode, SoItem.productNum,
      SoItem.customerPartNum, ObjectToObject.recordId2 AS kitParentLine, SoItem.note AS soItemNote, SoItem.description AS productDescription,
      ShipItem.qtyShipped AS qtyToFulfill, TaxRate.code AS itemTaxCode, SoItem.taxRate AS itemTaxRate, Currency.code AS currencyCode, Currency.symbol AS Symbol, (ShipItem.qtyShipped * SoItem.unitPrice) AS totalPrice,
      (SoItem.unitPrice + (SoItem.adjustAmount/SoItem.qtyToFulfill)) / COALESCE(So.currencyRate, 1) * COALESCE(uomConversion.factor/uomConversion.multiply, 1) AS currencyUnitPrice,
      ((ShipItem.qtyShipped * SoItem.unitPrice) / COALESCE(So.currencyRate, 1)) AS currencyTotalExtendedPrice, COALESCE(So.currencyRate, 1) AS currencyRate,
      ShipItem.id AS shipItemId, SoItem.taxRate * soitem.unitprice * shipitem.qtyshipped  AS soItemTaxAmount,
  	SoItem.typeId AS soItemTypeId, HomeCurrency.symbol AS homeCurrencySymbol, homecurrency.code AS HOMECURRENCYCODE,
      $P!{CustomField:Item1} AS itemcf1, $P!{CustomField:Item2} AS itemcf2, $P!{CustomField:Item3} AS itemcf3
  FROM So
      INNER JOIN SoItem ON So.id = SoItem.soId
  	INNER JOIN TaxRate ON soItem.taxId = TaxRate.id
      INNER JOIN Uom AS SoItemUom ON SoItem.uomId = SoItemUom.id
      INNER JOIN SoItemType ON SoItem.typeId = SoItemType.id
      INNER JOIN ShipItem ON SoItem.id = ShipItem.soItemId
      INNER JOIN Customer ON So.customerId = Customer.id
      LEFT OUTER JOIN UomConversion ON soItemUom.id = uomConversion.fromUomId AND soitem.uomId = uomConversion.toUomId
      LEFT OUTER JOIN ObjectToObject ON ObjectToObject.typeId = 30 AND SoItem.id = ObjectToObject.recordId1
      LEFT OUTER JOIN Currency ON Customer.currencyId = Currency.id
      LEFT OUTER JOIN Currency AS HomeCurrency ON HomeCurrency.homeCurrency = 1
  WHERE ShipItem.shipId = $P{shipID}
  ORDER BY SoItem.soLineItem
  ```
  - Only lines with ShipItems appear.
  - Qty is `ShipItem.qtyShipped`.
  - **totalPrice is qtyShipped × unitPrice and excludes the adjustment**, but unitCost still includes it.
  - The `ITEMID` group is on SHIPITEMID in every proforma, including CA and US.
- **Main query (AU verbatim):**
  ```sql
  SELECT Company.name AS company, So.num AS soNum, So.customerContact, So.customerPo, So.billToAddress, SHIP.shipToAddress,
      So.billToName, SHIP.shipToName, So.billToCity, SHIP.shipToCity, BillState.name AS billToState, ShipState.name AS shipToState,
      So.billToZip, SHIP.shipToZip, BillCountry.name AS billCountry, ShipCountry.name AS shipCountry, Ship.num AS shipNum, SUBSTRING(SHIP.NUM,2) AS HIPNUM,
      So.locationGroupId, COALESCE(So.note, '') AS soNote, So.customerId, COALESCE(CAST(Ship.dateShipped AS DATE), CURRENT_DATE) AS dateShipped,
      So.currencyRate,Currency.code AS currencyCode, Currency.symbol AS symbol, company.abn,
      SUM(ShipItem.qtyShipped * SoItem.unitPrice) AS subTotal,
      SUM(ROUND(SOITEM.TAXRATE * soitem.unitprice * shipitem.qtyshipped, 2)) AS ORDERTOTALTAX,
      SUM((CASE soitem.taxableflag WHEN 1 THEN so.taxrate ELSE 0 END) * (ShipItem.qtyShipped * SoItem.unitPrice)) AS taxRate,
      SUM(ROUND(soitem.unitprice * shipitem.qtyshipped * SOITEM.TAXRATE / SO.CURRENCYRATE, 2)) AS currencyTaxTotal,
      SUM((ShipItem.qtyShipped * SoItem.unitPrice) / So.currencyRate) AS currencySubTotal,
      SUM(((ShipItem.qtyShipped * SoItem.unitPrice) / So.currencyRate)
          + ((CASE soitem.taxableflag WHEN 1 THEN so.taxrate ELSE 0 END) * (ShipItem.qtyShipped * SoItem.unitPrice)) / So.currencyRate) AS currencyGrandTotal,
          NotInventory.itemCount, HomeCurrency.symbol AS homeCurrencySymbol,
  HOMECURRENCY.CODE AS HOMECURRENCYCODE, ship.id AS SHIPID, so.phone, so.email, COALESCE(contact.datus,'') AS fax,
  COALESCE(currency.symbol,homecurrency.symbol,91) AS coalesceSymbol
  FROM Ship
      INNER JOIN ShipItem ON Ship.id = ShipItem.shipId
      INNER JOIN SoItem ON ShipItem.soItemId = SoItem.id
      INNER JOIN So ON SoItem.soId = So.id AND Ship.soId = So.id
      INNER JOIN Customer ON So.customerId = Customer.id
      LEFT JOIN StateConst BillState ON So.billToStateId = BillState.id
      LEFT JOIN StateConst ShipState ON SHIP.shipToStateId = ShipState.id
      LEFT JOIN CountryConst BillCountry ON So.billToCountryId = BillCountry.id
      LEFT JOIN CountryConst ShipCountry ON SHIP.shipToCountryId = ShipCountry.id
      LEFT JOIN Currency ON Customer.currencyId = Currency.id
      LEFT JOIN Currency AS HomeCurrency ON HomeCurrency.homeCurrency = 1
      INNER JOIN Company ON Company.id = 1
      LEFT OUTER JOIN (SELECT COUNT(SoItem.id) AS itemCount, So.id FROM So INNER JOIN SoItem ON SoItem.soId = So.id
                       LEFT OUTER JOIN Product ON Product.id = SoItem.productId LEFT OUTER JOIN Part ON Part.id = Product.partId
                       WHERE (Part.typeId != 10 OR Part.typeId IS NULL) GROUP BY So.id) AS NotInventory ON NotInventory.id = So.id
      LEFT JOIN (SELECT contact.datus, so.id AS soid FROM contact
  			JOIN ship ON ship.id = $P{shipID} JOIN so ON ship.soid = so.id
  			JOIN customer ON contact.accountid = customer.accountid AND customer.id = so.customerid
  			WHERE contact.typeid = 40 AND contact.defaultflag = 1 LIMIT 1) AS contact ON contact.soid = so.id
  WHERE Ship.id = $P{shipID}
    AND SoItem.typeId != 40
  GROUP BY Company.name, So.num, So.customerContact, So.customerPo, So.billToAddress, SHIP.shipToAddress,
      So.billToName, SHIP.shipToName, So.billToCity, SHIP.shipToCity, BillState.name, ShipState.name,
      So.billToZip, SHIP.shipToZip, BillCountry.name, ShipCountry.name, Ship.num,
      So.locationGroupId, So.note, So.customerId, Ship.dateShipped,
      So.currencyRate, Currency.code, Currency.symbol, Company.id, So.taxRate, NotInventory.itemCount,
      HomeCurrency.symbol
  ```
  - There is no ORDER BY and no sysProperties join.
  - **The date falls back to today when the shipment has not shipped.**
  - The ship-to address comes straight from Ship.
  - The declared fields are unchanged; taxRate and itemCount are unused in AU.
  - The `postSoId` parameter is ignored; everything keys off `shipID`.
- **CA proforma** wraps every amount in the order-currency, adjustment-inclusive form shown below, and does not round per line.
  - subTotal is that amount × qtyShipped.
  - `currencySubTotal` divides by the rate **again**. This is a double-conversion bug for foreign currency.
  - Tax amounts use soitem.taxRate × the same base.
  - It uses MySQL's `IF()`.
  ```sql
  (SOITEM.UNITPRICE / COALESCE(SO.CURRENCYRATE, 1) + ((COALESCE(SOITEM.ADJUSTAMOUNT, 0) / IF(soitem.QTYTOFULFILL = 0,1,soitem.qtyTofulfill)) / SO.CURRENCYRATE))
  ```
  - The totals sub-dataset is renamed `totalsInfo`. This is cosmetic.
  - The SO CF1 detail has `isBlankWhenNull="false"`, so a null value prints as "null".
  - SO Notes elements are h15.
- **US proforma:**
  - The main query is like AU proforma but uses US SO-level tax: `taxRate` is `CASE taxableflag … so.taxrate`, and `currencyTaxTotal` is the CASE form. It has no ABN, and adds `so.paymentlink` and an `ITEMCOUNT` field (unused).
  - SUBTOTAL is Double.
  - **There is no "Cannot create invoice" message.** The title band is empty, with no height given.
  - `ShowTotals` default is `!Boolean.getBoolean("Multi Currency")`.
  - The currency parameters have `show="Multi Currency"` again.
  - An unused `ProformaTitle` parameter is declared.
  - The carton path is hard-coded `"../Ship/subCarton.jasper"`.
  - The approval line is longer: `"Approval:_____________________________     Date:_____________"` (29 underscores).
  - The Pay Online button is kept.
- **AU proforma layout changes:**
  - Tax Code detail has no left padding.
  - Tax Amount and Currency Tax details have no right padding.
  - Currency Extended Price header is right-aligned.
  - Otherwise the layout is identical to the AU invoice, including the "Cannot create invoice" title.

### 4.4 Default visible totals per edition (single currency)
- **AU:** "Subtotal:" / "GST:" / "Total:".
  - Subtotal = Σ posted line totalPrice (excluding subtotal lines) ÷ rate.
  - GST = Σ ROUND(soitem.taxRate × totalPrice ÷ rate, 2).
- **CA:** the same maths, with the label "Sales Tax:".
- **US:** "Sales Tax:", where tax = Σ (taxable lines × so.taxRate × totalPrice), rounded once.

### 4.5 The `_SpecialCharacters` variants (do not port)
- They are copies with every `fontName="Open Sans"` replaced by `"SansSerif"`, for non-Latin character sets.
- The master SC version calls `subShippingInvoice_<CC>_SpecialCharacters.jasper` and `subShippingProForma_<CC>_SpecialCharacters.jasper`.
- AU SC also:
  - passes `ShipID = $F{SHIPID}` to the carton subreport,
  - uses `subCartonSpecialCharacters.jasper`,
  - declares `FieldTitle:LxWxH`.
- subCartonSpecialCharacters fixes the carton-count title to use `FieldTitle:Cartoncount`, and gives the column headers stretch.

---

## 5. Conditional logic summary

### Which document prints
- Shipment status 30 gives the Invoice (posted data). Anything else gives the ProForma (live ShipItem data, with today's date if not shipped).
- If the SO or posting is missing, SONUM is null and a red bordered message prints instead of content (all variants except US proforma).

### Header
- Logo position is set by `cbLogoAlignment`: "left" (master default) or "top". Any other value shows no company block.
- The logo needs `module` to be set.
- Company name shows when `ShowCompanyName` is on.
- The address block shows when `module != null && ShowCompanyAddress`, and ShowCompanyAddress is always true.
  - AU prefixes a bold "ABN: <company.abn>" line.
  - CA prefixes "GST/HST: <abn>", or shows nothing at all if the ABN is null.
  - US has no prefix.
- The address body comes from the Java helper `getCompanyReportAddress(So.locationGroupId, ShowCountry)`. Replicate it as the company address for the SO's location group (or the company default), with the country line only when ShowCountry is on.
- The barcode (Code128B of SHIPNUM, no human-readable text) shows when `ShowBarcode` is on.
- The Order # box follows `cbOrderNumber`:
  - "Ship" shows SHIPNUM, or SHIPNUM without its first character when the system property "Barcodes have DI" is set and not "true".
  - "SO" shows SONUM.
  - "PO" shows CUSTOMERPO, falling back to SONUM.
- The Date box shows ship.dateShipped (date only) in the `REPORT_DATE_FORMAT` pattern.

### Bill To and Ship To
- **Bill To** comes from SO bill-to fields. It is followed, optionally, by:
  - Country (ShowCountry)
  - "Phone: " + so.phone (ShowBillToPhone)
  - "Email: " + so.email (ShowBillToEmail)
  - "Fax: " + the customer account's default contact of type 40, from `contact.datus` (ShowBillToFax)
- **Ship To** comes from Ship ship-to fields, with optional country. Underneath it, "Contact: {so.customerContact}" and/or "PO Number: {so.customerPo}".

### Carton block
- Shown only when `ShowCartonInfo` is on. It is placed between the address block and the order-info table.
- One row per shipcarton, ordered by carton number.
- Weight shows in the default weight UOM, or "lbs".
- Tracking numbers link to USPS, UPS or FedEx by carrier-name substring.
- Summary row: Total Weight (value only if > 0) and Carton Count.

### Notes
- Shown when `ShowNote` is on and so.note is non-empty: "SO Notes:" followed by the note text.

### Order info row
- Six boxed columns by default. Visibility per column: SalesPerson, PaymentTerms, FOBPoint, ShippingTerms, ShipVia, ReqShipDate, OrderCurrency, OrderCurrencyRate.
- **Payment terms** come from `paymentTerms.name` through so.paymentTermsId and appear only in this table. There are no payment instructions anywhere except the US Pay Online button.

### SO custom fields row
- Shown when `ShowSOCustomFields` is on. Each of the six columns shows when its ShowCfSO N option is on.

### Items table
- Column visibility follows the options listed above.
- `UnitPrice` and `ExtendedPrice` default to on when multi-currency is off. `CurrencyUnitPrice` and `CurrencyExtendedPrice` default to on when it is on.
- Kit components (lines with an ObjectToObject type-30 parent) have their Item / Item-Description text indented by 5 spaces.
- **Line numbering:**
  - When `IncludeKitsInItemNumbering` is true (the default), numbering is 1..N over all rows, kit parents included.
  - When false, kit parent rows (type 80) are blank and the other rows count up, incrementing on each new ShipItem (AU invoice) or PostSoItem (CA/US).
- **Type column:** any type name starting with "Discount" displays as "Discount".
- **Discount % lines (type 30):** Unit Price shows the line total. Extended Price for types 30 and 40 is the line total; otherwise it is unitCost × qty, rounded.
- unitCost = unitPrice + adjustAmount / so-item qtyToFulfill.
- **Description cell** contains:
  1. The description
  2. A new line, 2 spaces, then the tracking info from `getAllShipItemTrackingInfo("ShipItem", shipItemId)`, when present
  3. A new line, 2 spaces, then the line note, when present
  The Item/Description combined column does the same.
- **AU/CA line tax** = qty × unitCost × soitem.taxRate. This is not rounded and uses the PriceDecimal pattern. The Tax Code column shows taxRate.code.
- **Zebra striping:** even rows on each page get a #EAEAEA background.
- **Total Qty footer** (`ShowTotalQty`) sums every row, including kit parents, kit components and non-product lines.

### Totals block
Pinned to the bottom-right of the last page.

- **Visibility:** `isMultiCurrency ? (ShowHomeCurrencyTotals || ShowCurrencyTotals) : ShowTotals`.
- **Tax label:** "GST:" when `AccountingModule.isAu()`, otherwise "Sales Tax:", unless FieldTitle:SalesTax overrides it.

Single-currency and default case:
- Subtotal = CURRENCYSUBTOTAL.
- Tax = CURRENCYTAXTOTAL.
- Total = Subtotal + Tax.
- Formatting: `getFormattedCurrency(coalesceSymbol, value, REPORT_DECIMAL_TOTAL)`. coalesceSymbol is the customer currency symbol id, then the home currency's, then 91.
  - If Open Sans cannot draw that symbol's character, the value is formatted with the pattern minus its first character (no symbol).

With home-currency totals on:
- A home column is added, labelled with the home currency code:
  - HCSubTotal = round((curSub + curTax) × rate) − curTax × rate.
  - Home tax = ORDERTOTALTAX.
  - Home total = sum of the two.
- With currency totals also on, an order-currency column labelled with the currency code is added too. Its Total has the bug described in §2.7.

### Footer, left side (last page)
- If `ShowDeliverySignature` is on: the signature image from `getImageData("Ship", shipId, true)` plus a "Received By:" label.
- Otherwise, if `Column:CustomFooterText` is on: the system property "SO Notice", or the default approval/date line. It is 8pt and bottom-aligned.

### US only
- The Pay Online button and caption, shown when `so.paymentlink` is non-empty and `ShowPayOnlineButton` is on.

### Every page (master footer)
- Printed date-time, "Page N of", and the total page count.

### Currency formatting
- In non-multi-currency mode, values are numbers formatted with the Fishbowl patterns (`REPORT_DECIMAL_PRICE` for unit price and tax, `REPORT_DECIMAL_TOTAL` for extended price and totals). These patterns normally carry the currency sign.
- In multi-currency mode, line values are pre-formatted strings from `getFormattedCurrency(symbolId, value, pattern)`, using the home symbol for home columns and the customer symbol for currency columns.

---

## 6. Gotchas

### Java helpers you must replace
- `com.fbi.util.PropertyUtil.isCaOrInternational()` and `.isAu()` select the edition.
- `com.evnt.eve.modules.AccountingModule.isAu()` sets the GST label.
- `CurrencyModule.isMultiCurrency()`.
- `ReportHelperModule`, through `$P{module}`:
  - `getRoundedMoneyValue(double, true)`: rounds to money precision, 2 dp.
  - `getAllShipItemTrackingInfo("ShipItem", id)`: returns a pre-formatted tracking string.
  - `getCompanyReportAddress(lgId, showCountry)`: returns a multi-line address.
  - `getImageData("Company", 1, true)` and `getImageData("Ship", shipId, true)`, decoded with `com.evnt.util.ImageUtil.decodeImage`.
- `com.fbi.sdk.constants.setup.CurrencySymbolConst.getFormattedCurrency(symbolId, value, pattern)` and `getConstant(id).getSymbol()`. Symbol ids are integers; 91 is the hard fallback, presumably "$" (I did not verify this).

### Fishbowl conventions
- **FieldTitle parameters** are tested with `.equals("%")`. Fishbowl passes "%" for unset titles, and a real null would throw an exception. Treat null, empty and "%" all as "use the default label".
- **`Property…` string defaults on Boolean parameters** (`"PropertyMulti Currency"` means on when multi-currency is enabled; `"PropertyNotMulti Currency"` means on when it is disabled) are resolved by Fishbowl's report runner. These strings are present in the compiled `.jasper`.
  - `ShippingTerms` uses `"PropertyNotMultiCurrency"` without the space. That probably refers to a property that does not exist and so resolves to true. This is unverified.
- **`$P!{...}` is raw SQL substitution:**
  - `postSoId` is inlined as text.
  - `CustomField:*` are SQL expressions that Fishbowl supplies. If one is unset, it becomes `null AS socfN`.
- **The `col*` parameters the master passes are dead.** All real values travel through `REPORT_PARAMETERS_MAP`, so the master defaults override the sub defaults (`cbLogoAlignment` is "left", `ShowTotals` is true).
- **`postSoId` types:** it is an Integer in the main sub but declared as a String in the itemInfo dataset. It works only because it is bound as a JDBC parameter.

### JasperReports behaviour to mimic
- **Hidden table columns** (column printWhen) are evaluated once against the *main* report's parameters and fields, and the remaining columns pack to the left. Proof: the CA columns reference main-dataset fields, and the US columns reference `$P{ItemNumber}`, which does not exist in its sub-dataset.
- **Default font:** the last `isDefault` style ("note") wins, so any element without an explicit size is 9pt. This affects the Order#/Date labels, company address, Contact/PO box, and some CA/US order-info cells.
- **Subreport margins (30/20) apply inside the master, and `runToBottom` pins the last page footer to the bottom.** So the totals, approval line and signature always sit at a fixed position on the last page (page y 605–738), not directly after the items.
- **Repeats on every page:** the page header (logo, title, order #, date, barcode) and the items table column header.
- **Prints once:** the address block, carton block, notes and order-info table.
- **The `lines == 1` guards** effectively mean "print once"; the main query returns one row.

### Data quirks
- **AU invoice item numbering bug:** the ITEMID group is keyed on SHIPITEMID. Consecutive posted rows with no ShipItem (discount, misc, shipping lines) count as one group, so `Line` does not advance between them. CA and US fixed this by grouping on postsoitemid.
- **Tooltip contradicts logic:** the `IncludeKitsInItemNumbering` tooltip says "Kits will not be included … when checked", but checked actually numbers every row.
- **No null guards on Bill To** (phone, email, fax, country) or on the AU "ABN:" line. A null value prints the literal "null".
  - `PRODUCTDESCRIPTION.length()` in the PartInfo variable would throw if the description were null. Treat null as "".
  - A null description in the Description column prints as "null".
- **US `paymentlink`:** `!$F{paymentlink}.equals(null)` throws if paymentlink is SQL NULL while ShowPayOnlineButton is on. Treat null as "no link".
- **Order Currency column** shows the hard-coded "USD" when multi-currency is off, even on AU/CA.
- **Line tax vs totals tax:** AU/CA line tax is qty × unitCost × taxRate, unrounded and including adjustments. The total GST is Σ ROUND(taxRate × posted totalPrice, 2), so line-level tax may not sum to the GST total.
  - In the proforma, totalPrice excludes adjustAmount, while unitCost (and so the line tax and extended price) includes it.
- **Totals Total in the order-currency column** (home and currency both shown) uses the home `taxTotal`. In CA proforma, currencySubTotal is double-divided by the rate.
- **CA company address** disappears completely when `company.abn` is null.
- **Carton block:**
  - The per-row weight hides until the running totalWeight is above 0.
  - Weight and total weight use Java `Double.toString` ("5.0 lbs"), not the pattern.
  - A USPS carrier matches both the USPS and UPS (`contains("UPS")`) printWhens, so the two overlap.
  - The Carton Count label uses `FieldTitle:TotalWeight`.
  - `COALESCE(LEN,'')` mixes numbers and strings; treat empty dimensions as blank or 0.
- **Overflows:**
  - The items table defaults to 553 (AU) or 554 (CA/US) wide, 1–2pt past the 552 column.
  - The order-info table can reach 736 wide with the currency columns on.
  - The SO Notes text runs to x 553.
- **Excluded from the sums:** SO item type 40 (subtotal lines) is excluded from the main sums, but subtotal lines still appear as item rows with Extended Price = totalPrice.
- **Type ids the report relies on:** 30 (discount %), 40 (subtotal), 80 (kit). Kit components are linked with ObjectToObject typeId 30. Contact typeid 40 is fax. `ship.orderTypeId = 20` means SO.
- **MySQL-specific SQL:** loose `GROUP BY` (non-aggregated selected columns), `LIMIT`, `SUBSTRING(x,2)`, `IF()` (CA proforma), and `CURRENT_DATE`.
- **Master query edge case:** `LIMIT 1` with no ORDER BY picks an arbitrary PostSo if a shipment ever had more than one posting.
