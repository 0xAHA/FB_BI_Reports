# Fishbowl stock Purchase Order report (POReport): spec for an HTML rebuild

**Sources read in full:**
- `C:\Program Files\Fishbowl\server\reports\PurchaseOrder\POReport.jrxml` (4760 lines)
- `C:\Program Files\Fishbowl\server\reports\Common\subMemo.jrxml` (156 lines, references no further subreports)

The only external subreport is `subMemo`. The line-item grid, the order-info strip, the PO custom-field strip and the totals block are **JasperReports table components**. Each runs its own sub-dataset query (`POinfo` or `Item Info`), so they behave like subreports and are covered in §6.

**Units and coordinates:** everything is in pt. Band-relative x/y are measured from the left margin, so page x = 30 + x. Page y = band top + y.

---

## 1. PAGE

| Property | Value |
|---|---|
| Report name | `PurchaseOrderReport` |
| Page size | pageWidth **612**, pageHeight **792** (US Letter, portrait; no orientation attribute) |
| Margins | left **30**, right **30**, top **20**, bottom **20** |
| columnWidth | **552** (one column) |
| whenNoDataType | `AllSectionsNoDetail` |
| Bands present | title, columnHeader, columnFooter, summary and background are empty. Non-empty: **pageHeader** (134), 5 **group headers**, **3 alternative detail bands** (45 each), **pageFooter** (14), **lastPageFooter** (118). No noData band. |

**Fonts.** Every element uses **Open Sans** (pdfEncoding Cp1252, not embedded).
- Sizes used: 6 (spacer only), 8, 9, 10, 14, 17.
- Bold is used for headers, labels and totals. There is no italic, except that the `address` style is italic and it is never used.

**Declared styles** (all Open Sans):

| Style | Size / weight |
|---|---|
| `9` | 9 |
| `10` | 10 |
| `12` | 12 |
| `14` | 14 |
| `10b` | 10 bold |
| `12b` | 12 bold |
| `14b` | 14 bold |
| `16b` | 16 bold |
| `18b` | 18 bold |
| `24b` | 24 bold |
| `10i` | 10 italic |
| `12i` | 12 italic |
| `10bu` | 10 bold underline |
| `header1` | 24 bold |
| `header2` | 18 bold |
| `header3` | 16 bold |
| `addressHeader` | 14 bold |
| `date` | 12 |
| `type` | 12 |
| `address` | 10 italic |
| `column_head` | 10 bold |
| `body` | 10 |
| `note` | 9 |
| `Barcode` | hAlign Center, vAlign Middle, box topPadding 0 |
| `Zebra` | Open Sans. Conditional: when `$V{PAGE_COUNT}.intValue() % 2 == 0`, mode Opaque, backcolor **#EAEAEA** |

**Default style.** Three styles are flagged `isDefault="true"`: `10`, `body` and `note`. JasperReports uses the last one declared, which is **`note` (Open Sans 9)**.
- Any element below with no explicit size therefore renders at **9pt**. I mark these "(size unspecified → 9)".
- Please confirm this against a real PDF. It affects the Order #/Date labels, the company address and the Notes text.

---

## 2. PARAMETERS

### 2a. Record-id parameters

| Name | Class | Default | Where it is used |
|---|---|---|---|
| `poNum` | String | `"10010"` (Tooltip "Select a purchase order to run the report for") | Main query `WHERE po.num = $P{poNum}`, and again inside the fax derived table (`INNER JOIN po ON po.num = $P{poNum}`). This is the PO **number**, not the id. |
| `poId` | Integer | `1` | Declared only in sub-datasets `POinfo` and `Item Info`, as `WHERE po.id = $P{poId}`. Every table component passes `datasetParameter poId = $F{RECORDID}`, which is `PO.ID` from the main query. |
| subMemo `recordID` | String | `"%"` | Passed `$F{RECORDID}.toString()` |
| subMemo `tableID` | String | `"%"` | Passed the hard-coded string `"397076832"` (the PO table id in `memo.tableid`) |

### 2b. Option parameters (main report)

All are `isForPrompting="false"`. The Tab/Group properties drive Fishbowl's options UI.

**Defaults written `"PropertyMulti Currency"` / `"PropertyNotMulti Currency"`:**
- These are strings assigned to Boolean parameters. Fishbowl must preprocess them, otherwise Java would not compile.
- Read them as: `"PropertyMulti Currency"` = true when multi-currency is ON; `"PropertyNotMulti Currency"` = true when multi-currency is OFF.
- `property show="Multi Currency"` / `show="!Multi Currency"` only controls whether the option appears in the UI.

**Header / address / general options:**

| Param | Default | Description / tooltip |
|---|---|---|
| ShowBillToPhone | true | Tab Address / Group Bill To |
| ShowBillToFax | true | Tab Address / Group Bill To |
| ShowBillToEmail | true | Tab Address / Group Bill To |
| ShowStatus | false | Status under title |
| ShowCountry | false | Country on all addresses |
| ShowMemos | false | |
| ShowVendorAccountNumber | false | |
| ShowTotals | true | show=!Multi Currency |
| ShowCurrencyTotals | true | show=Multi Currency |
| ShowHomeCurrencyTotals | false | show=Multi Currency |
| ShowNotes | true | |
| ShowCompanyName | true | |
| ShowCompanyAddress | true | |
| ShowBarcode | true | |
| ShowVendorContact | true | desc "Show Vendor Name" |
| UseVendorNameInAddress | true | Vendor name instead of remit-to name |
| ShowPartNumber | false | Fishbowl part # in parentheses |
| ShowLineItemNotes | true | |
| ShowOutsourceReturnAs | true | Tooltip: requires the Number/Description combined column |
| ShowTotalQty | false | |
| ShowPOCustomFields | false | Tab Custom Fields, Sort -1 |
| cbLogoAlignment | `"left"` | String. Description `top,Top,left,Left` = combobox values `top` / `left` |

**Order-field strip (Tab Hide/Show, Group Order Fields):**

| Param | Default |
|---|---|
| OrderBuyer | true |
| OrderPaymentTerms | true |
| OrderFOBPoint | true |
| OrderShippingTerms | true |
| OrderShipVia | true |
| OrderShipService | false |
| OrderDateScheduled | true |
| OrderCurrency | false |
| OrderCurrencyRate | false |

**Item columns (Tab Hide/Show, Group Item Columns):**

| Param | Default | Description |
|---|---|---|
| Item# | true | |
| ItemType | true | |
| ItemPart | true | desc "Item Number" |
| ItemFulfillmentDate | false | |
| ItemDescription | true | |
| ItemUnitPrice | "PropertyNotMulti Currency" | desc "Item Unit Cost" |
| ItemOtyOrdered | true | sic; desc "Item Quantity Ordered" |
| ItemExtendedPrice | "PropertyNotMulti Currency" | desc "Item Total Cost" |
| ItemNumberAndDescription | false | |
| ItemCurrencyUnitCost | "PropertyMulti Currency" | |
| ItemCurrencyTotal | "PropertyMulti Currency" | |
| ItemTaxCode | false | |
| ItemTax | false | |
| ItemCurrencyTax | false | |
| ItemRevision | false | |

**Custom-field parameters** (Tab Custom Fields):

| Param | Class | Default | Notes |
|---|---|---|---|
| `CustomField:PO1` … `PO6` | String | none | property Table=PO, Type=Custom Field. Holds a **raw SQL expression** injected with `$P!{}` |
| `ShowCfPO1` … `ShowCfPO6` | Boolean | true | |
| `FieldTitle:POcf1` … `POcf6` | String | none | |
| `CustomField:Item1` … `Item3` | String | none | Table=poitem |
| `ShowCfItem1` … `ShowCfItem3` | Boolean | false | |
| `FieldTitle:Itemcf1` … `Itemcf3` | String | none | |

**FieldTitle label overrides** (String, no default, Tab "Field Titles"):
- Order#, Date, ShipTo, Vendor, PaymentTerms, FOBPoint, Buyer, ShippingTerms, ShipVia, Service, DateScheduled, OrderCurrency, CurrencyRate
- Item#, Type, Revision, FulfillmentDate, Number, Description, UnitCost, QtyOrdered, UOM, TotalCost, Tax, TaxCode, Total, ReportTitle, SalesTax, ItemTotal

Every expression tests `.equals("%")` to mean "unset, use the built-in label". So Fishbowl passes `"%"` for blank string parameters. In the rebuild, treat `%`, null or empty as "use the default".

**Declared only in sub-datasets, not in main** (so they keep their defaults and drive nothing visible):
- POinfo: `OrderFulfillmentDate` (true)
- Item Info: `ShowItemFulfillmentDate` (false) and `AddTaxIntegrationEstimatedTaxToTotal` (false)
- Item Info also re-declares many main parameters with its own defaults. `ItemUnitPrice` and `ItemExtendedPrice` default to `true` there. These are overridden, because every datasetRun passes `$P{REPORT_PARAMETERS_MAP}`.

### 2c. System / internal parameters

| Param | Class | Default / use |
|---|---|---|
| `path` | String | `"../PurchaseOrder/"`. Subreport path is `$P{path} + "../Common/subMemo.jasper"` |
| `module` | Object | null. Cast to `com.evnt.eve.modules.ReportHelperModule` for the logo and company address; injected by Fishbowl |
| `dateRangeNone` | java.util.Date | Unused |
| `REPORTDESCRIPTION` | String | `"Purchase Order Details"`. Unused in layout |
| `REPORT_CONNECTION` | built-in | Used for every datasetRun and the subreport |
| `REPORT_PARAMETERS_MAP` | built-in | Passed to every table dataset |
| `IS_IGNORE_PAGINATION` | built-in | Hides footer date and page numbers when true |

`CURRENT_USER` is not declared or used.

---

## 3. MAIN QUERY (verbatim)

```sql
SELECT
    PO.VENDORCONTACT,
    PO.VENDORSO,
    PO.VENDORID,
    PO.NOTE,
    PO.ID AS RECORDID,
    COALESCE(UPPER(SYSPROPERTIES.SYSVALUE), 'US') AS QBVERSION,
    CURRENCY.CODE AS CURRENCYCODE,

    /*SHIP TO*/
    PO.SHIPTONAME,
    PO.SHIPTOADDRESS,
    PO.SHIPTOCITY,
    SHIPSTATE.CODE AS SHIPTOSTATE,
    PO.SHIPTOZIP,
    SHIPCOUNTRY.NAME AS SHIPTOCOUNTRY,

    /*REMIT TO*/
    PO.REMITTONAME,
    PO.REMITADDRESS AS REMITTOADDRESS,
    PO.REMITCITY AS REMITTOCITY,
    REMITSTATE.CODE AS REMITTOSTATE,
    PO.REMITZIP AS REMITTOZIP,
    REMITCOUNTRY.NAME AS REMITTOCOUNTRY,
    PO.PHONE,
    PO.EMAIL,
    COALESCE(FAX.DATUS,'') AS FAX,
    COMPANY.ABN,
    HOMECURRENCY.SYMBOL AS HOMECURRENCYSYMBOL,
    vendor.accountnum AS VENDORACCOUNTNUMBER,
    vendor.name AS vendorName,
    PO.LOCATIONGROUPID AS LOCATIONGROUPID,
    COMPANY.NAME AS COMPANY,
    PO.NUM AS NUM, PO.STATUSID,
    POSTATUS.NAME AS POSTATUS,
    PO.DATELASTMODIFIED, PO.DATEISSUED

FROM po
    INNER JOIN poItem ON po.id = poItem.poId
    INNER JOIN vendor ON po.vendorId = vendor.id
    INNER JOIN company ON company.id = 1
    LEFT OUTER JOIN stateConst AS shipState ON po.shipToStateId = shipState.id
    LEFT OUTER JOIN stateConst AS remitState ON po.remitStateId = remitState.id
    LEFT OUTER JOIN countryConst AS shipCountry ON po.shipToCountryId = shipCountry.id
    LEFT OUTER JOIN countryConst AS remitCountry ON po.remitCountryId = remitCountry.id
    LEFT OUTER JOIN sysProperties ON sysProperties.sysKey = 'QBVersion'
    LEFT OUTER JOIN currency ON vendor.currencyId = currency.id
    LEFT OUTER JOIN postatus ON postatus.id = po.statusid
    LEFT OUTER JOIN currency AS homeCurrency ON homeCurrency.homeCurrency = 1
    LEFT OUTER JOIN (SELECT contact.datus, po.id AS poId
                     FROM contact
                     INNER JOIN po ON po.num = $P{poNum}
                     INNER JOIN vendor ON contact.accountid = vendor.accountid AND vendor.id = po.vendorId
                     WHERE contact.typeid = 40
                       AND contact.defaultflag = 1
                     LIMIT 1) AS fax ON fax.poId = po.id

WHERE po.num = $P{poNum}

GROUP BY
    po.vendorContact, po.vendorSo, po.vendorId, po.shipToZip, shipCountry.name, po.shipToName,
    po.shipToAddress, po.shipToCity, shipState.code, po.remitZip, remitCountry.name, po.currencyRate,
    currency.code, currency.symbol, po.remitToName, po.remitAddress, po.remitCity, remitState.code,
    po.note, po.id, po.totalTax, sysProperties.sysValue, company.ABN, homeCurrency.symbol
```

The query returns **exactly one row per PO**, because the GROUP BY collapses the poItem join. If the PO has **no line items** it returns **zero rows**.

**Fields:**

| Field | Class |
|---|---|
| VENDORCONTACT | String |
| VENDORSO | String |
| VENDORID | Integer |
| NOTE | String |
| RECORDID | Integer |
| QBVERSION | String (unused) |
| CURRENCYCODE | String |
| SHIPTONAME | String |
| SHIPTOADDRESS | String |
| SHIPTOCITY | String |
| SHIPTOSTATE | String |
| SHIPTOZIP | String |
| SHIPTOCOUNTRY | String |
| REMITTONAME | String |
| REMITTOADDRESS | String |
| REMITTOCITY | String |
| REMITTOSTATE | String |
| REMITTOZIP | String |
| REMITTOCOUNTRY | String |
| PHONE | String |
| EMAIL | String |
| FAX | String |
| ABN | String |
| HOMECURRENCYSYMBOL | Integer (a CurrencySymbolConst id, not a character) |
| VENDORACCOUNTNUMBER | String |
| LOCATIONGROUPID | Integer |
| COMPANY | String |
| NUM | String |
| STATUSID | Integer |
| POSTATUS | String |
| DATELASTMODIFIED | Timestamp |
| DATEISSUED | Timestamp |
| vendorName | String |

---

## 4. VARIABLES and GROUPS

### Main-report variables

None has a calculation, so each holds its expression value.

| Var | Class | Reset | Expression |
|---|---|---|---|
| VendorContact | String | None | `($F{VENDORCONTACT} != null) && (!$F{VENDORCONTACT}.equals("")) ? "Contact: " + $F{VENDORCONTACT} : ""` |
| VendorSO | String | None | `(($F{VENDORSO} != null) && (!$F{VENDORSO}.equals(""))) ? "Sales Order Number: " + $F{VENDORSO} : ""` |
| FooterMessage | String | None | `System.getProperty("PO Notice")` |
| PriceDecimal | String | None | `System.getProperty("REPORT_DECIMAL_PRICE")` |
| QtyDecimal | String | None | `System.getProperty("REPORT_DECIMAL_QTY")` |
| CostDecimal | String | None | `System.getProperty("REPORT_DECIMAL_COST")` |
| DateFormat | String | None | `System.getProperty("REPORT_DATE_FORMAT")` |
| BarcodesHaveDI | String | None | `System.getProperty("Barcodes have DI")` |
| isMultiCurrency | Boolean | Report | `com.evnt.eve.modules.CurrencyModule.isMultiCurrency()` |
| isUnitedStates | Boolean | Report | `!(com.evnt.eve.modules.AccountingModule.isInternational())` |
| isCanada | Boolean | Report | `com.evnt.eve.modules.AccountingModule.isCa()` |
| isAustralia | Boolean | Report | `com.evnt.eve.modules.AccountingModule.isAu()` |

Typical system-property values:
- `REPORT_DECIMAL_*` (price, cost, total): e.g. `$ #,##0.00`. The first character is the currency symbol.
- `REPORT_DECIMAL_QTY`: e.g. `#,##0.#####`.
- `REPORT_DATE_FORMAT`: e.g. `MM/dd/yyyy`.

### Sub-dataset `POinfo` variables
- `DateFormat` (as in the main report).

### Sub-dataset `Item Info` variables

Reset type is Report (per dataset run) unless noted.

| Var | Calc | Expression |
|---|---|---|
| isUnitedStates / isCanada / isAustralia | – | Same as main |
| ShowPartNums | – | `$P{ShowPartNumber}.toString()` |
| PartInfo | – | `(ShowPartNums=="true" ? "(" + PARTNUM + ")  " : "") + (VENDORPARTNUM == null ? "" : VENDORPARTNUM + "; " + DESCRIPTION)`. **Unused.** |
| ItemNumDesc | – (reset None) | See exact logic below |
| PriceDecimal, QtyDecimal, CostDecimal, DateFormat, TotalsDecimal | – (reset None) | System properties; TotalsDecimal = `REPORT_DECIMAL_TOTAL` |
| taxAmount | – | `$V{isCanada} ? $F{CURRENCYTAXTOTAL} : ($F{TOTALCOST} * $F{TAXRATE})` |
| CAUnitCost | – | `CURRENCYRATE == 1.0 ? CURRENCYUNITCOST : BigDecimal.valueOf(CURRENCYUNITCOST).setScale(2, ROUND_HALF_UP).doubleValue() * CURRENCYRATE` |
| CATotalCost | – | Same pattern using CURRENCYTOTALCOST |
| priceDecimalNoSymbol / totalsDecimalNoSymbol / costDecimalNoSymbol | – | Pattern with its first character removed (`.substring(1)`) |
| CanDisplaySymbol | – (initial true) | `SYMBOL == null \|\| SYMBOL.equals("") \|\| new java.awt.Font("Open Sans",PLAIN,1).canDisplay(CurrencySymbolConst.getConstant(SYMBOL).getSymbol().charAt(0))` |
| isMultiCurrency | – | `CurrencyModule.isMultiCurrency()` |
| SubTotal | **Sum** | `$F{CURRENCYTOTALCOST}` |
| taxTotal | **Sum** | `$F{CURRENCYTAXTOTAL}` |
| homeCurrencyTaxTotal | none (last value) | `$F{TOTALTAX}` (PO-level `po.totalTax`) |
| homeCurrencySubtotal | **Sum** | `$F{TOTALCOST}` |
| TotalQty | **Sum** | `$F{QTYTOFULFILL}` |

**ItemNumDesc logic:**
```
(ShowPartNums=="true" ? "(" + PARTNUM + ")  " : "")
+ (VENDORPARTNUM == null ? "" : VENDORPARTNUM)
+ (PARTNUM.length() > 1 && DESCRIPTION.length() > 1 ? " - " : "")
+ DESCRIPTION
+ (ShowOutsourceReturnAs && !OUTSOURCEDPARTNUMBER.equals("")
     ? "\n   Returning As:\n   " + OUTSOURCEDPARTNUMBER + " - " + OUTSOURCEDPARTDESCRIPTION
     : "")
```

`Item Info` declares group **"Total Info"** with no expression, so it is one group over the whole dataset. The totals table uses its group footer, which prints once at the end.

### Main-report groups

They are listed outermost to innermost. All header bands print once, before the detail. None has keepTogether, startNewPage or reprintHeader.

| Group | Expression | Header band | Footer |
|---|---|---|---|
| CustomerAddresses | `new Integer(1)` | 98 | none |
| Notes | `new Integer(1)` | 19, printWhen `($F{NOTE} != null) && ($F{NOTE}.length() > 0) && $P{ShowNotes}` | none |
| Memos | empty (null) | 19, printWhen `$P{ShowMemos}` | none |
| info | `null` | 38 | empty band |
| CustomFields | `$F{VENDORID}` | 38, printWhen `$P{ShowPOCustomFields}` | none |

---

## 5. BANDS

All boxes are black unless stated. "Pens 0.5 all" means a 0.5pt black border on all four sides. No splitType is set anywhere, so the default is Stretch.

### 5.1 pageHeader — height 134, repeats on every page (page y 20–154)

Elements, top-to-bottom then left-to-right:

1. **Logo/company frame "Left Logo"**: frame 0,0,358×134, printWhen `$P{cbLogoAlignment}.equals("left")`.
   - **Image "Logo"**: 0,0, 75×134. Opaque white background, no border. scaleImage RetainShape, hAlign Center, vAlign Middle, not cached. printWhen `new Boolean($P{module} != null)`. Source: `com.evnt.util.ImageUtil.decodeImage(((ReportHelperModule)$P{module}).getImageData("Company", 1, true))`.
   - **textField "CompanyName"**: 75,33, 283×20. Open Sans **14 bold**, left, vAlign Top, leftPadding 3, stretch. printWhen `$P{ShowCompanyName}`. Text `$F{COMPANY}`.
   - **textField company address**: 75,53, 283×81. positionType Float, stretch, blankWhenNull. markup **styled**, size unspecified → 9, vAlign Top, leftPadding 3. printWhen `$P{module} != null && $P{ShowCompanyAddress}`. Text: `(AccountingModule.isAu() ? "<b>ABN: </b>" + $F{ABN} + "\n" : "") + ((ReportHelperModule)$P{module}).getCompanyReportAddress($F{LOCATIONGROUPID}, $P{ShowCountry})`.

2. **Frame "Top Logo"**: 0,0,358×134, printWhen `$P{cbLogoAlignment}.equals("top")`.
   - **Image**: 0,0, 356×40. RetainShape, vAlign **Bottom**, hAlign default (left), cached. Same printWhen and source as above.
   - **CompanyName**: 0,40, 358×20. **14 bold**, vAlign **Middle**, no padding. printWhen ShowCompanyName.
   - **Address**: 0,60, 358×74. Float, stretch, styled, size → 9, vAlign Top, bottomPadding 3. Same expression and printWhen as above.

3. **Report title** textField: x 356, y 0, 196×24. Open Sans **17 bold**, align **Right**, vAlign **Bottom**, transparent, stretch, evaluationTime Report.
   ```
   $P{FieldTitle:ReportTitle}.equals("%")
     ? ($F{STATUSID} < 20 ? ($V{isAustralia} == true ? "Request for Quote" : "Bid Request") : "Purchase Order")
     : $P{FieldTitle:ReportTitle}
   ```

4. **Status** textField: 438,21, 100×12. Open Sans **8**, align Center, vAlign Top, leftPadding 3, stretch. printWhen `$P{ShowStatus}`. Text `"(" + $F{POSTATUS} + ")"`. Its top 3pt overlap the title box.

5. **"Order #" header**: 358,33, 125×17. Opaque **#EAEAEA**, pens 0.5 all, Center/Middle, bold (size unspecified → 9), markup none, Float. Text: `FieldTitle:Order# == "%" ? "Order #" : FieldTitle:Order#`.

6. **"Date" header**: 483,33, 69×17. Opaque #EAEAEA, pens 0.5 all, Center/Middle, bold (→9), Float. Text: `FieldTitle:Date == "%" ? "Date" : FieldTitle:Date`.

7. **Order # value**: 358,50, 125×17. Pens 0.5 all, padding L3 R3, Center/Middle, **10 bold**, Float, stretch. Text: `BarcodesHaveDI == null ? NUM : (BarcodesHaveDI.equals("true") ? "P" + NUM : NUM)`.

8. **Date value**: 483,50, 69×17. Pens 0.5 all, Center/Middle, **10 regular**, Float, stretch. Text `DATEISSUED == null ? DATELASTMODIFIED : DATEISSUED`. patternExpression `$V{DateFormat}`.

9. **Barcode** (componentElement, barbecue): 359,77, 193×47. Style Barcode (centered), Float. printWhen `$P{ShowBarcode}`. Type **Code128B**, drawText **false**, checksumRequired false, barHeight 50, evaluationTime Report. Code is the same expression as the Order # value.

### 5.2 Group header CustomerAddresses — height 98 (page y 154–252 when nothing stretches)

1. **Vendor label**: 0,0, 271×17. Opaque #EAEAEA, pens 0.5 all, leftPadding 3, left, vAlign **Bottom**, **10 bold**. Text: `FieldTitle:Vendor == "%" ? "Vendor:" : FieldTitle:Vendor`.

2. **Ship To label**: 281,0, 271×17. Same styling. Text: `FieldTitle:ShipTo == "%" ? "Ship To:" : FieldTitle:ShipTo`.

3. **Vendor address box**: 0,17, 271×44. Stretch, blankWhenNull, padding 3 all sides, pens 0.5 all, vAlign Top, 10 regular. printWhen **`$F{SHIPTONAME} != null`** (sic; it tests the ship-to name). Text:
   ```
   (UseVendorNameInAddress
       ? (vendorName == null ? (REMITTONAME == null ? "" : REMITTONAME + "\n") : vendorName + "\n")
       : (REMITTONAME == null ? "" : REMITTONAME + "\n"))
   + (REMITTOADDRESS == null ? "" : REMITTOADDRESS + "\n")
   + (REMITTOCITY null/blank ? "" : REMITTOCITY + ", ")
   + (REMITTOSTATE null/blank ? "" : REMITTOSTATE + "  ")      // two spaces
   + (REMITTOZIP == null ? "" : REMITTOZIP)
   + (ShowCountry ? "\n" + REMITTOCOUNTRY : "")
   + (ShowBillToPhone ? "\nPhone: " + PHONE : "")
   + (ShowBillToEmail ? "\nEmail: " + EMAIL : "")
   + (ShowBillToFax ? "\nFax: " + FAX : "")
   + (ShowVendorAccountNumber ? "\nAccount #: " + VENDORACCOUNTNUMBER : "")
   ```

4. **Ship To address box**: 281,17, 271×44. Same box styling, printWhen `$F{SHIPTONAME} != null`. Text:
   ```
   (SHIPTONAME==null ? "" : SHIPTONAME + "\n")
   + (SHIPTOADDRESS==null ? "" : SHIPTOADDRESS + "\n")
   + city ", " + state "  " + zip                      // same blank rules as vendor box
   + (ShowCountry ? "\n" + SHIPTOCOUNTRY : "")
   ```

5. **Vendor contact / SO line**: 0,66, 271×11. positionType **Float**, **isRemoveLineWhenBlank**, stretch, padding L3 R3 (T0 B0), pens 0.5 all, vAlign Middle, 10. printWhen `$P{ShowVendorContact} && (!$V{VendorContact}.equals("") || !$V{VendorSO}.equals(""))`. Text: `VendorContact + (both non-empty ? "\n" : "") + VendorSO`. That gives "Contact: X" and/or "Sales Order Number: Y".

6. **GST/HST line**: 0,82, 271×11. Float, stretch, padding L3 R3, pens 0.5 all, vAlign Middle, 10. printWhen `com.fbi.util.PropertyUtil.isCaOrInternational()`. Text `"GST/HST: " + (ABN == null ? "" : ABN)`.

**Stretch behaviour:**
- The two address boxes stretch **independently**; they are not equalised.
- Items 5 and 6 float down by the amount the vendor box stretched, because they overlap it horizontally. Each keeps its 5pt gap.
- If item 5 is not printed, its 11pt line is removed, so item 6 moves up by about 11.

### 5.3 Group header Notes — height 19

Band printWhen: NOTE is not empty **and** ShowNotes.

1. **staticText "Notes:"**: 0,0, 33×19. Open Sans **bold**, size unspecified → 9, left/top.
2. **textField**: 33,0, 519×19. Stretch, leftPadding 3, bottomPadding 5, vAlign Top, size → 9, no borders. Text `$F{NOTE}`.

### 5.4 Group header Memos — height 19

Band printWhen `$P{ShowMemos}`.

1. **subreport** 0,0, 552×14. Opaque white, isUsingCache. printWhen `$P{ShowMemos}`. See §6.1. This leaves a 5pt gap below.

### 5.5 Group header info — height 38

1. **Table** 0,0, 552×28 on dataset POinfo. See §6.2.
2. **Spacer staticText**: 0,28, 552×10, empty.

### 5.6 Group header CustomFields — height 38

Band printWhen `$P{ShowPOCustomFields}`.

1. **Table** 0,0, 552×28 on dataset POinfo. See §6.3.
2. **Spacer staticText**: 0,28, 552×10, size 6, empty.

### 5.7 Detail — three alternative bands, each height 45

Only one prints. Each band holds a single table at 0,0, 552×45 on dataset **Item Info**; see §6.4.

| Band | printWhen |
|---|---|
| Band 1 | `$V{isUnitedStates}` |
| Band 2 | `$V{isCanada}` |
| Band 3 | `$V{isAustralia}` |

Because the main query returns one row, the detail band prints once. The table expands to show all line items and breaks across pages.

### 5.8 pageFooter — height 14

Printed on every page **except the last**. Page y 758–772.

1. **Date/time printed**: 0,0, 323×14. 9pt, Left/Bottom. printWhen `!$P{IS_IGNORE_PAGINATION}`. Text `DateFormat.getDateTimeInstance(DateFormat.LONG, DateFormat.LONG).format(new Date())`, e.g. "October 12, 2026 at 3:45:12 PM MDT" (Java 9+ wording).
2. **"Page N of"**: 323,0, 205×14. 9pt, **Right**/Bottom, rightPadding 4. Same printWhen. Text `"Page " + $V{PAGE_NUMBER} + " of"`.
3. **Total pages**: 528,0, 24×14. 9pt, Left/Bottom, evaluationTime **Report**. Same printWhen. Text `$V{PAGE_NUMBER}`.

### 5.9 lastPageFooter — height 118

Last page only, page y 654–772.
- On the last page the item table must end above page y 654. Other pages can run to y 758.
- The totals therefore sit **pinned to the bottom of the last page**, not directly under the items.

1. **PO Notice text**: 0,1, 293×95. Open Sans **8**, markup **styled**, vAlign **Bottom**, rightPadding 15, stretch, evaluationTime Report. Text `$V{FooterMessage}`, which is the "PO Notice" system property.
2. **Totals table**: 293,54, 259×42 on dataset Item Info. See §6.5. printWhen:
   ```
   $V{isMultiCurrency} ? ($P{ShowHomeCurrencyTotals} || $P{ShowCurrencyTotals}) : $P{ShowTotals}
   ```
3. **Date/time printed**: 0,105, 347×13. 9pt, Left/Bottom, `!IS_IGNORE_PAGINATION`. Same text as 5.8.
4. **"Page N of"**: 347,105, 181×13. 9pt, Right/Bottom, rightPadding 4.
5. **Total pages**: 528,105, 24×13. 9pt, Left/Bottom, evaluationTime Report.

---

## 6. SUBREPORTS and TABLE DATASETS

### 6.1 subMemo (`../Common/subMemo.jasper`, in the Memos group)

- **Wiring:** parameters `recordID = $F{RECORDID}.toString()` and `tableID = "397076832"`. Connection is REPORT_CONNECTION.
- **Report setup:** pageWidth 552, height 792, all margins 0, whenNoDataType AllSectionsNoDetail. It declares the same styles; its default is also `note` (9pt).
- **Parameters:** `ISSUBREPORTONLY` (String), `tableID` (default "%"), `recordID` (default "%").
- **Query (verbatim):**
  ```sql
  SELECT *
  FROM memo
  WHERE tableid = $P{tableID}
    AND recordid = $P{recordID}
  ORDER BY id
  ```
- **Fields:** ID Integer, MEMO String, USERNAME String, DATECREATED Timestamp, TABLEID Integer, RECORDID Integer.
- **Variable:** DateFormat = `System.getProperty("REPORT_DATE_FORMAT")`.

**Bands:**
- **title** (14): staticText "Memos", 0,0, 552×14. Style 12b with the font overridden to size 10, so Open Sans **10 bold**. Left, vAlign Bottom, transparent.
- **columnHeader** (14), repeats per page. Three staticTexts, each opaque **#EAEAEA**, leftPadding 3, bottomPen 0.5, Open Sans **10 bold**, left/top:
  - "Date" at 0,0, 54×14
  - "User" at 55,0, 54×14
  - "Memo" at 110,0, 442×14
  - This leaves 1pt white gaps at x 54 and x 109.
- **detail** (13). Three textFields, each stretch with stretchType RelativeToBandHeight, leftPadding 3, bottomPen **0.25 #CCCCCC**, left/top, size → 9:
  - 0,0, 55×13: `(new SimpleDateFormat($V{DateFormat})).format($F{DATECREATED})`
  - 55,0, 55×13: `$F{USERNAME}`
  - 110,0, 442×13: `$F{MEMO}`
- pageHeader and pageFooter are empty.

### 6.2 "info" order-field table (dataset POinfo)

**POinfo query (verbatim):**
```sql
SELECT
    PO.BUYER,
    FOBPOINT.NAME AS FOBPOINT,
    SHIPTERMS.NAME AS SHIPPINGTERMS,
    CARRIER.NAME AS CARRIERNAME,
    PO.DATEFIRSTSHIP,
    PAYMENTTERMS.NAME AS PAYMENTTERMS,
    CURRENCY.CODE AS CURRENCYCODE,
    PO.CURRENCYRATE AS CURRENCYRATE,
    HOMECURRENCY.CODE AS HOMECURRENCYCODE,
    CARRIERSERVICE.NAME AS CARRIERSERVICE,
    $P!{CustomField:PO1} AS pocf1,
    $P!{CustomField:PO2} AS pocf2,
    $P!{CustomField:PO3} AS pocf3,
    $P!{CustomField:PO4} AS pocf4,
    $P!{CustomField:PO5} AS pocf5,
    $P!{CustomField:PO6} AS pocf6

FROM po
    INNER JOIN potype ON po.typeid = potype.id
    INNER JOIN fobpoint ON po.fobpointid = fobpoint.id
    INNER JOIN shipterms ON po.shiptermsid = shipterms.id
    INNER JOIN paymentterms ON po.paymenttermsid = paymentterms.id
    INNER JOIN vendor ON po.vendorid = vendor.id
    INNER JOIN carrier ON po.carrierid = carrier.id
    LEFT OUTER JOIN carrierservice ON po.carrierserviceid = carrierservice.id
    LEFT OUTER JOIN postatus ON postatus.id = po.statusid
    LEFT OUTER JOIN currency ON vendor.currencyId = currency.id
    LEFT OUTER JOIN currency homeCurrency ON homeCurrency.homeCurrency = 1

WHERE po.id = $P{poId}
```

**Fields:** BUYER, FOBPOINT, SHIPPINGTERMS, CARRIERNAME (String); DATEFIRSTSHIP (Timestamp); PAYMENTTERMS, CURRENCYCODE (String); CURRENCYRATE (Double); HOMECURRENCYCODE, CARRIERSERVICE, pocf1–pocf6 (String).

**Table layout:**
- Columns are each **92 wide**. Hidden columns collapse and the visible ones pack from x=0.
- The table has a header row (14) and one detail row (14).
- Every cell has a 0.5pt black box on all sides.
- Header cell: opaque **#EAEAEA**, **10 bold**, Center/Middle, markup none.
- Detail cell: 10 regular, Center/Middle, stretch, blankWhenNull.

| # | Show param | Header (default label) | Detail value |
|---|---|---|---|
| 1 | OrderBuyer | FieldTitle:Buyer → "Buyer" | BUYER |
| 2 | OrderPaymentTerms | FieldTitle:PaymentTerms → "Payment Terms" | PAYMENTTERMS |
| 3 | OrderFOBPoint | FieldTitle:FOBPoint → "FOB Point" | FOBPOINT |
| 4 | OrderShippingTerms | FieldTitle:ShippingTerms → "Shipping Terms" | SHIPPINGTERMS |
| 5 | OrderShipVia | FieldTitle:ShipVia → "Ship Via" | CARRIERNAME |
| 6 | OrderShipService | FieldTitle:Service → "Service" | CARRIERSERVICE |
| 7 | OrderDateScheduled | FieldTitle:DateScheduled → "Date Scheduled" | DATEFIRSTSHIP, pattern `$V{DateFormat}` |
| 8 | OrderCurrency | FieldTitle:OrderCurrency → "Order Currency" | `CURRENCYCODE == null ? HOMECURRENCYCODE : CURRENCYCODE` |
| 9 | OrderCurrencyRate | FieldTitle:CurrencyRate → "Currency Rate" | CURRENCYRATE, pattern `" #,##0.0#######"` (leading space) |

With default options, columns 1–5 and 7 show: 6 × 92 = **552**, which is exactly full width.

### 6.3 PO custom-fields table (dataset POinfo, CustomFields group)

- 6 columns × **92**, printWhen `ShowCfPO1`…`ShowCfPO6` (each defaults to true).
- Header: same styling as 6.2. Text `FieldTitle:POcfN == "%" ? "Custom Field N" : FieldTitle:POcfN`.
- Detail: `$F{pocfN}`, 10, align **Center**, vAlign default **Top**, box 0.5 all.

### 6.4 Line-item tables (dataset "Item Info"), one per region

**Item Info query (verbatim):**
```sql
SELECT
    POITEM.ID,
    POITEM.POLINEITEM,
    POITEMTYPE.NAME AS TYPE,
    PO.CURRENCYRATE,
    POITEM.PARTNUM,
    POITEM.VENDORPARTNUM,
    POITEM.DESCRIPTION,
    POITEM.NOTE,
    POITEM.QTYTOFULFILL,
    UOM.CODE AS UOMCODE,
    POITEM.UNITCOST,
    POITEM.TOTALCOST,
    POITEM.DATESCHEDULEDFULFILLMENT,
    CURRENCY.CODE AS CURRENCYCODE,
    CURRENCY.SYMBOL,
    TAXRATE.CODE AS TAXCODE,
    POITEM.TAXRATE,
    CASE COALESCE(UPPER(SYSPROPERTIES.SYSVALUE), 'US')
        WHEN 'US' THEN (POITEM.UNITCOST / COALESCE(PO.CURRENCYRATE,1)) * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1)
        WHEN 'CA' THEN POITEM.UNITCOST * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1) / COALESCE(PO.CURRENCYRATE,1)
        WHEN 'AU' THEN POITEM.UNITCOST * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1) / COALESCE(PO.CURRENCYRATE,1)
        ELSE 0.0
    END AS CURRENCYUNITCOST,

    CASE COALESCE(UPPER(SYSPROPERTIES.SYSVALUE), 'US')
        WHEN 'US' THEN (POITEM.UNITCOST / COALESCE(PO.CURRENCYRATE,1) * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1)) * POITEM.QTYTOFULFILL
        WHEN 'CA' THEN (POITEM.UNITCOST * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1)) * POITEM.QTYTOFULFILL / COALESCE(PO.CURRENCYRATE,1)
        WHEN 'AU' THEN (POITEM.UNITCOST * COALESCE(UOMCONVERSION.FACTOR / UOMCONVERSION.MULTIPLY,1)) * POITEM.QTYTOFULFILL / COALESCE(PO.CURRENCYRATE,1)
        ELSE 0.0
    END AS CURRENCYTOTALCOST,
    (POITEM.QTYTOFULFILL * POITEM.UNITCOST) * COALESCE(POITEM.TAXRATE,0) / COALESCE(PO.CURRENCYRATE,1) AS CURRENCYTOTALTAX,
    ROUND(POITEM.UNITCOST / PO.CURRENCYRATE, 2) * PO.CURRENCYRATE AS USCURRENCYUNITCOST,
    ROUND(POITEM.UNITCOST / PO.CURRENCYRATE * POITEM.QTYTOFULFILL, 2) * PO.CURRENCYRATE AS USTOTALCOST,
    HOMECURRENCY.SYMBOL AS HOMECURRENCYSYMBOL,
    COALESCE(currency.symbol,homecurrency.symbol,91) AS coaleseSymbol,
    PO.TYPEID AS TYPEID,
    COALESCE(PO.TOTALTAX,0.0) AS TOTALTAX,
    CASE COALESCE(UPPER(SYSPROPERTIES.SYSVALUE), 'US')
        WHEN 'CA' THEN ROUND((CAST((poitem.qtytofulfill * poitem.unitcost) AS DECIMAL(28,9)) * CAST((poitem.taxrate / po.currencyrate) AS DECIMAL(28,9))),2)
        WHEN 'AU' THEN ROUND(CAST(((POITEM.UNITCOST * POITEM.QTYTOFULFILL) * POITEM.TAXRATE) / PO.CURRENCYRATE AS DECIMAL(12,2)),2)
        ELSE 0.0
    END AS CURRENCYTAXTOTAL,
    HOMECURRENCY.CODE AS HOMECURRENCYCODE, poitem.revlevel,
    OUTSOURCEDPARTNUMBER, OUTSOURCEDPARTDESCRIPTION,
    $P!{CustomField:Item1} AS itemcf1,
    $P!{CustomField:Item2} AS itemcf2,
    $P!{CustomField:Item3} AS itemcf3

FROM
    po
    INNER JOIN poItem ON po.id = poItem.poId
    INNER JOIN poItemType ON poItem.typeId = poItemType.id
    INNER JOIN uom ON poItem.uomid = uom.id
    INNER JOIN vendor ON po.vendorId = vendor.id
    LEFT OUTER JOIN uomConversion ON uom.id = uomConversion.fromUomId AND poitem.uomId = uomConversion.toUomId
    LEFT OUTER JOIN currency ON vendor.currencyId = currency.id
    LEFT OUTER JOIN taxRate ON poItem.taxId = taxRate.id
    LEFT OUTER JOIN sysProperties ON sysProperties.sysKey = 'QBVersion'
    LEFT OUTER JOIN currency AS homeCurrency ON homeCurrency.homeCurrency = 1

WHERE po.id = $P{poId}

ORDER BY poitem.polineitem
```

**Fields:**

| Field | Class |
|---|---|
| ID | Integer |
| POLINEITEM | Integer |
| TYPE | String |
| CURRENCYRATE | Double |
| PARTNUM | String |
| VENDORPARTNUM | String |
| DESCRIPTION | String |
| NOTE | String |
| QTYTOFULFILL | Double |
| UOMCODE | String |
| UNITCOST | Double |
| TOTALCOST | Double |
| DATESCHEDULEDFULFILLMENT | Timestamp |
| CURRENCYCODE | String |
| SYMBOL | Integer |
| TAXCODE | String |
| TAXRATE | Double |
| CURRENCYUNITCOST | Double |
| CURRENCYTOTALCOST | Double |
| CURRENCYTOTALTAX | Double |
| USCURRENCYUNITCOST | Double |
| USTOTALCOST | Double |
| HOMECURRENCYSYMBOL | Integer |
| coaleseSymbol | Integer |
| TYPEID | Integer |
| TOTALTAX | Double |
| CURRENCYTAXTOTAL | Double |
| HOMECURRENCYCODE | String |
| revlevel | String |
| OUTSOURCEDPARTDESCRIPTION | String |
| OUTSOURCEDPARTNUMBER | String |
| itemcf1, itemcf2, itemcf3 | String |

**Common cell styling (all three regional tables):**
- **Column header row, height 30.**
  - The cell box has a bottom pen 0.5 #000000 and left/right pens **1.0 #FFFFFF**. Exception: the Item CF columns (and Revision in CA/AU) have only the bottom 0.5 pen.
  - Inside is a textField at 0,0, width×**28**, opaque **#EAEAEA**, Open Sans **10 bold**, vAlign **Bottom**, markup none.
  - So the header is a grey block 28 tall, a 2pt white strip, then a 0.5 black rule at y=30.
  - The cell borders are drawn after the contents, so the white 1pt side pens show as **1pt white separators between columns** over the grey.
  - Labels wrap to two lines inside the 28pt height (for example "Qty / Ordered").
- **Detail row, height 13 minimum.**
  - Cell box has left/right pens 1.0 #FFFFFF and no other borders. The Item CF and Revision detail cells have no box.
  - The textField fills the cell (w×13), style **Zebra**, stretchType RelativeToBandHeight (every cell in a row grows to the tallest), isStretchWithOverflow, blankWhenNull, Open Sans **9**, vAlign Top unless stated.
  - **Zebra:** rows 2, 4, 6… of each page get **#EAEAEA**; odd rows are white. The count restarts on each page.
- **Header row repeats** at the top of each page the table continues onto.

#### Region A — US table (band 1)

Columns in order. Visible columns pack left from x=0.

| # | W | Show param | Header text | Hdr align | Detail value | Det. align | Padding | Pattern |
|---|---|---|---|---|---|---|---|---|
| 1 | 31 | Item# | FieldTitle:Item# / "Item #" | Center | POLINEITEM | Center | L3 R3 | – |
| 2 | 50 | ItemType | FieldTitle:Type / "Type" | Center | TYPE | Center/Top | L3 R3 | – |
| 3 | 90 | ShowCfItem1 | FieldTitle:Itemcf1 / "Item CF 1" | Center | itemcf1 | Center/Top | L3 R3 | – |
| 4 | 50 | ItemRevision | FieldTitle:Revision / "Revision" | Center | revlevel | Center/Top | L3 R3 | – |
| 5 | 70 | ItemFulfillmentDate | FieldTitle:FulfillmentDate / "Fulfillment Date" | Center | DATESCHEDULEDFULFILLMENT | Center | L3 R3 | `$V{DateFormat}` |
| 6 | 245 | ItemNumberAndDescription | see note (1) | Left, leftPadding 3 | `$V{ItemNumDesc}` + note suffix (2); markup **styled** (US only) | Left/Top | L3 R3 | – |
| 7 | 70 | ItemPart | FieldTitle:Number / "Number" | Left, lp3 | `(ShowPartNums=="true" ? "(" + PARTNUM + ")  " : "") + (VENDORPARTNUM==null ? "" : VENDORPARTNUM)` | Left | L3 R3 | – |
| 8 | 175 | ItemDescription | FieldTitle:Description / "Description" | Left, lp3 | DESCRIPTION + note suffix (2) | Left | L3 R3 | – |
| 9 | 90 | ShowCfItem2 | "Item CF 2" | Center | itemcf2 | Center | L3 **R5** | CostDecimal (no effect on a String) |
| 10 | 72 | ItemUnitPrice | FieldTitle:UnitCost / "Unit Cost" | Center | `isMultiCurrency ? getFormattedCurrency(HOMECURRENCYSYMBOL, USCURRENCYUNITCOST, CostDecimal) : UNITCOST` | Right | L3 R5 | CostDecimal |
| 11 | 72 | ItemCurrencyUnitCost | `SYMBOL==null ? <UnitCost label> : CURRENCYCODE + " " + <UnitCost label>` | Center | `SYMBOL==null ? fmt(HOMECURRENCYSYMBOL, UNITCOST, CostDecimal) : fmt(SYMBOL, CURRENCYUNITCOST, CostDecimal)` | Right | L3 R5 | CostDecimal |
| 12 | 83 | ItemOtyOrdered | Two header fields: "Qty Ordered" (FieldTitle:QtyOrdered) at 0,0, 50×28, **Right**; "UOM" (FieldTitle:UOM) at 50,0, 33×28, Center | – | QTYTOFULFILL at 0,0, 50×13, Right, padding L0 R3, rightPen 1.0 white, pattern QtyDecimal. UOMCODE at 50,0, 33×13, Center, padding 0, leftPen 1.0 white | – | – | – |
| 13 | 72 | ItemCurrencyTotal | `SYMBOL==null ? "Total" : CURRENCYCODE + " Total"` | Center | `SYMBOL==null ? fmt(HOMECURRENCYSYMBOL, TOTALCOST, CostDecimal) : fmt(SYMBOL, CURRENCYTOTALCOST, TotalsDecimal)` | Right | L3 R5 | CostDecimal |
| 14 | 72 | ItemExtendedPrice | FieldTitle:TotalCost / "Total Cost" | Center | `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, USTOTALCOST, CostDecimal) : TOTALCOST` | Right | L3 R5 | CostDecimal |
| 15 | 90 | ShowCfItem3 | "Item CF 3" | Center | itemcf3 | Center | L3 R5 | CostDecimal |

`fmt` means `com.fbi.sdk.constants.setup.CurrencySymbolConst.getFormattedCurrency`.

**US table footer (only in the US table, on the Qty column):**
- A row of height 14. It is present whenever column 12 is visible.
- It contains a textField at 0,1, 50×13: Open Sans **9 bold**, Right, padding L0 R3, **topPen 0.5 black**, rightPen 1.0 white.
- printWhen `$P{ShowTotalQty}`. Value `$V{TotalQty}`, pattern QtyDecimal.

**Note (1), Number/Description header:**
```
FieldTitle:Description=="%" && FieldTitle:Number=="%"
  ? "Number / Description"
  : (FieldTitle:Number=="%" ? "Number" : FieldTitle:Number) + " / " + (FieldTitle:Description=="%" ? "Description" : FieldTitle:Description)
```

**Note (2), line-note suffix:** `(ShowLineItemNotes && NOTE != null && !NOTE.equals("")) ? "\n  " + NOTE : ""` (newline plus two-space indent).

**Default visible widths:**
- Without multi-currency: 31 + 50 + 70 + 175 + 72 (Unit Cost) + 83 + 72 (Total Cost) = **553**, 1pt wider than 552. The table simply overflows by 1pt.
- With multi-currency on: Unit Cost and Total Cost hide, Currency Unit Cost and Currency Total show. Also 553.

#### Region B — Canada table (band 2)

Differences from US:
- No table footer, so there is **no TotalQty** in CA.
- Tax columns are added.
- Column order: Total Cost comes **before** Currency Total.
- Header boxes on CF1, CF2, CF3 **and Revision** have only the bottom 0.5 pen.

| # | W | Show param | Header | Detail | Align / padding |
|---|---|---|---|---|---|
| 1–8 | 31, 50, 90, 50, 70, 245, 70, 175 | as US | as US | As US, except col 6 detail has **no** styled markup | as US |
| 9 | 90 | ShowCfItem2 | "Item CF 2" | itemcf2 | Center/Top, L3 R3, no pattern |
| 10 | 72 | ItemUnitPrice | "Unit Cost" | `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, $V{CAUnitCost}, CostDecimal) : UNITCOST` | Right, L3 R5, CostDecimal |
| 11 | 72 | ItemCurrencyUnitCost | as US | as US | Right, L3 R5 |
| 12 | 83 | ItemOtyOrdered | "Qty Ordered" 0,0, 50×28, **Center**; "UOM" 50,0, 33×28, Center | QTYTOFULFILL 50×13, Right, padding **L1 R1**, QtyDecimal. UOMCODE 33×13, **Left** (default), padding L1 R1 | – |
| 13 | 72 | ItemExtendedPrice | "Total Cost" | `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, $V{CATotalCost}, CostDecimal) : TOTALCOST` | Right, L3 R5, CostDecimal |
| 14 | 72 | ItemCurrencyTotal | `SYMBOL==null ? "Total" : CURRENCYCODE + " Total"` | as US col 13 | Right, L3 R5 |
| 15 | 61 | ItemTaxCode | FieldTitle:TaxCode / "Tax Code" | TAXCODE | Center, L1 R1 |
| 16 | 90 | ItemTax | FieldTitle:Tax / "Tax" | `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, $V{taxAmount}, CostDecimal) : $V{taxAmount}` | Right, L3 R5, CostDecimal |
| 17 | 90 | ItemCurrencyTax | `(SYMBOL==null \|\| CURRENCYCODE==null) ? <Tax label> : CURRENCYCODE + " " + <Tax label>` (header has no markup attribute) | `SYMBOL==null ? fmt(HOMECURRENCYSYMBOL, $V{taxAmount}, CostDecimal) : fmt(SYMBOL, CURRENCYTOTALTAX, CostDecimal)` | Right, L3 R5 |
| 18 | 90 | ShowCfItem3 | "Item CF 3" | itemcf3 | Center, L3 R5 |

#### Region C — Australia table (band 3)

Same as Canada (18 columns, same widths, order and styling, no TotalQty footer) except:
- **Col 10, Unit Cost:** `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, UNITCOST, CostDecimal) : UNITCOST`. It uses UNITCOST, not CAUnitCost.
- **Col 13, Total Cost:** `isMultiCurrency ? fmt(HOMECURRENCYSYMBOL, TOTALCOST, CostDecimal) : TOTALCOST`.
- **Col 14, Currency Total header:** `SYMBOL==null ? (FieldTitle:ItemTotal=="%" ? "Total" : FieldTitle:ItemTotal) : CURRENCYCODE + " " + (same)`. Only AU honours `FieldTitle:ItemTotal`.
- The tax value (`$V{taxAmount}`) for AU = `TOTALCOST * TAXRATE`. CA uses CURRENCYTAXTOTAL.

### 6.5 Totals table (lastPageFooter, dataset Item Info)

- Placed at 293,54, 259×42.
- Detail cells have height 0, so there are no per-item rows.
- Content comes from the **"Total Info" group footer** (one row, height 15 minimum) plus a column-header row (14). The header row only has content in the two 95-wide currency columns.

| Col | W | Column printWhen | Header (14) | Group-footer cell (15) |
|---|---|---|---|---|
| A spacer | 45 | `!ShowHomeCurrencyTotals \|\| !isMultiCurrency \|\| CURRENCYCODE == null` | – | Empty |
| B spacer | 95 | `ShowHomeCurrencyTotals && isMultiCurrency && CURRENCYCODE != null && !ShowCurrencyTotals` | – | Empty |
| C labels | 69 | Always | – | See below |
| D value | 145 | Same as A | – | See below |
| E vendor-currency value | 95 | `ShowHomeCurrencyTotals && isMultiCurrency && CURRENCYCODE != null && ShowCurrencyTotals` | `$F{CURRENCYCODE}`: opaque #EAEAEA, 10 bold, Right/Middle, rightPadding 3, bottomPen 0.5, rightPen 1.0 white | Same contents as D, width 95 |
| F home-currency value | 95 | `ShowHomeCurrencyTotals && isMultiCurrency && CURRENCYCODE != null` | `$F{HOMECURRENCYCODE}`: same styling but leftPen 1.0 white, bottomPen 0.5 | Uses HOMECURRENCYSYMBOL, homeCurrencyTaxTotal and homeCurrencySubtotal |

**Column C (labels) contents:**
- Tax label at 0,0, 69×**1**: opaque white, stretch (it grows to its text height, about 14), 10 bold, Right/Middle, rightPadding 3, rightPen 1.0 white. printWhen `$V{isCanada} || $V{isAustralia}`. Text: `FieldTitle:SalesTax=="%" ? (AccountingModule.isAu() ? "GST:" : "Sales Tax:") : FieldTitle:SalesTax`.
- Total label at 0,1, 69×14: Float, opaque **#EAEAEA**, 10 bold, Right/Middle, rightPadding 3. Text `FieldTitle:Total=="%" ? "Total:" : FieldTitle:Total`.

**Column D (value) contents:**
- Total value at 0,1, 145×14: Float, opaque #EAEAEA, 10 bold, Right/Middle, rightPadding 3, left and right pens 1.0 white. Text:
  ```
  CanDisplaySymbol ? fmt(coaleseSymbol, SubTotal + taxTotal, TotalsDecimal)
                   : new DecimalFormat(totalsDecimalNoSymbol).format(SubTotal + taxTotal)
  ```
- Tax value at 0,0, 145×1: white, stretch, printWhen CA||AU. Same formatting with `taxTotal`.

**Column F (home currency) contents:**
- Tax value: `fmt(HOMECURRENCYSYMBOL, homeCurrencyTaxTotal, TotalsDecimal)`.
- Total value: `fmt(HOMECURRENCYSYMBOL, homeCurrencySubtotal + homeCurrencyTaxTotal, TotalsDecimal)`.
- Both use the same DecimalFormat fallback when CanDisplaySymbol is false.

**Net layouts**, each 259 wide:

| Case | Columns | Header row |
|---|---|---|
| (i) Normal | 45 spacer + 69 labels + 145 value. Labels at page x 368, value at page x 437–582 | Blank, height 0 |
| (ii) Home currency only | 95 spacer + 69 labels + 95 home | Home code above the home value |
| (iii) Both currencies | 69 labels + 95 vendor + 95 home | Vendor code and home code |

**Vertical:**
- US: the tax line does not print. The grey Total row sits at cell y=1 to 15, leaving a 1pt white gap above it.
- CA/AU: a white tax row (about 14pt) prints first, and the grey Total row is pushed below it.

---

## 7. CONDITIONAL LOGIC SUMMARY

**Edition (US / CA / AU):**
- `AccountingModule` picks exactly one item table. US = `!isInternational()`.
- US has no tax columns and a TotalQty footer.
- CA and AU add Tax Code, Tax and Currency Tax columns and a Sales Tax / GST row in the totals.
- Title: AU says "Request for Quote" where others say "Bid Request" (status < 20).
- AU company address is prefixed with "**ABN:** <ABN>".
- The "GST/HST: <ABN>" box under the vendor shows when `PropertyUtil.isCaOrInternational()`, which includes AU.
- The SQL currency and tax maths branch on `sysproperties.QBVersion` (US/CA/AU; anything else gives 0.0).

**Title:**
- Uses FieldTitle:ReportTitle if set.
- Otherwise: STATUSID < 20 gives "Bid Request" (AU: "Request for Quote"); anything else gives "Purchase Order".

**Header:**
- Status "(name)" shows if ShowStatus.
- Barcode shows if ShowBarcode.
- Order # shows "P" + NUM when system property "Barcodes have DI" = "true". The same rule applies to the barcode value.
- Date shows DATEISSUED, falling back to DATELASTMODIFIED.

**Logo and company:**
- `cbLogoAlignment` "left" gives a 75pt-wide logo column with name and address to its right. "top" gives a 356×40 logo above name and address. Any other value shows nothing.
- The logo comes from `ReportHelperModule.getImageData("Company", 1, true)`, which is the Company record #1 picture.
- Company name is company #1's name.
- The address comes from `getCompanyReportAddress(po.locationGroupId, ShowCountry)`. This is a Fishbowl helper; it presumably resolves the location-group or company address and returns styled text.
- Logo and address need `module` to be non-null. They are controlled by ShowCompanyName and ShowCompanyAddress.

**Addresses:**
- The vendor box uses remit-to fields. Its first line is the vendor name if UseVendorNameInAddress (falling back to remit-to name), else the remit-to name.
- Optional lines: Country (ShowCountry), Phone / Email / Fax (each default on), and Account # (ShowVendorAccountNumber).
- Fax is the vendor account's default contact of type 40.
- Contact and vendor SO line: needs ShowVendorContact and a non-empty value.
- Ship-to adds country only when ShowCountry.

**Notes and memos:**
- The PO note shows if non-empty and ShowNotes.
- Memos show if ShowMemos (subreport).

**Order-info strip:** each 92pt column toggled by the Order* params; labels overridable via FieldTitle.

**PO custom fields:**
- The whole strip needs ShowPOCustomFields (default false). Each column then follows ShowCfPOn (default true).
- The value comes from raw SQL in `CustomField:POn`.
- Label: FieldTitle:POcfn, default "Custom Field n".

**Item custom fields:**
- Three 90pt columns: CF1 after Type, CF2 after Description, CF3 at the end. Each toggled by ShowCfItemN (default false).
- Labels default to "Item CF n".

**Item column switching for multi-currency:**
- Without multi-currency: plain Unit Cost and Total Cost show by default, formatted with the CostDecimal pattern (whose first character is the currency sign).
- With multi-currency: those two hide by default, and "<CODE> Unit Cost" and "<CODE> Total" show in the vendor currency via `getFormattedCurrency(SYMBOL, …)`. If the vendor has no currency (SYMBOL null), they fall back to home currency and plain labels.
- If a user re-enables the home-currency columns under multi-currency, they show home-currency values with the home symbol:
  - US uses re-derived rounded values (USCURRENCYUNITCOST, USTOTALCOST).
  - CA uses CAUnitCost / CATotalCost (round the foreign amount to 2 decimals, then multiply by the rate).
  - AU uses the raw UNITCOST / TOTALCOST.

**Number columns:**
- The "Number" column is the **vendor** part number. The Fishbowl part number is prefixed "(PART)  " only with ShowPartNumber.
- The combined Number/Description column (off by default) adds "Returning As" lines for outsourced items when ShowOutsourceReturnAs.
- Line notes append under the description (ShowLineItemNotes).

**Totals:**
- Shown when `isMultiCurrency ? (ShowHomeCurrencyTotals || ShowCurrencyTotals) : ShowTotals`.
- The column layout switches as in §6.5.
- Total = Σ CURRENCYTOTALCOST + Σ CURRENCYTAXTOTAL, in the vendor currency (coaleseSymbol: vendor symbol, else home symbol, else id 91).
- Home total = Σ TOTALCOST + po.totalTax.

**Label overrides:** every FieldTitle:X is used only if it is not "%".

**Currency formatting:**
- `getFormattedCurrency(symbolId, value, pattern)` returns a String with the right symbol, and honours Fishbowl's "Currency Use Code" setting.
- Otherwise a DecimalFormat pattern from REPORT_DECIMAL_COST, _TOTAL or _QTY is used. For example `$ #,##0.00` gives "$ 1,234.50", where "$" is a literal.
- CanDisplaySymbol falls back to the pattern without its first character when Open Sans lacks the glyph.
- Currency rate uses `" #,##0.0#######"`.
- Dates use REPORT_DATE_FORMAT. The footer timestamp uses Java LONG/LONG.

**Footer:**
- PO Notice text (system property "PO Notice") shows bottom-left on the last page only.
- Page "N of M" and the timestamp are hidden when IS_IGNORE_PAGINATION.

**Not present:** no kit or drop-ship handling, no item-type-based sign or format logic, no discount or freight lines, no tax on US totals, no images other than the logo.

---

## 8. GOTCHAS

1. **The PO number drives the main query; the PO id drives the sub-datasets.** The main WHERE is `po.num = poNum`; every table dataset gets `poId = PO.ID`. The fax derived table re-filters by `poNum` and uses `LIMIT 1`.

2. **A PO with zero line items returns no main row**, because of the INNER JOIN poItem. With AllSectionsNoDetail you get only the page header and footer with blank or null values.

3. **Exactly one detail band prints.** If `isInternational()` is true but neither isCa nor isAu (some other edition), **no item table prints at all**.

4. **The address boxes are hidden when `SHIPTONAME` is null**, and this includes the vendor box. That looks like a copy/paste bug; replicate it or fix it deliberately.

5. **String concatenation of nulls prints the word "null":**
   - "Phone: null", "Email: null" and "Account #: null" when the value is null and the option is on.
   - ShowCountry with a null country prints "null".
   - Fax is null-safe (COALESCE '').
   - `ItemNumDesc` calls `.length()` / `.equals()` on PARTNUM, DESCRIPTION and OUTSOURCEDPARTNUMBER without null guards.
   - The " - " separator in ItemNumDesc depends on **PARTNUM** length, but the text shown is VENDORPARTNUM. So you can get " - Desc" when the vendor part number is empty.

6. **US totals never include tax.** CURRENCYTAXTOTAL is 0.0 for US, and the tax row only prints for CA/AU.
   - CA/AU line tax is rounded to 2 decimals per line in SQL, then summed.
   - The CA/AU "Tax" column uses `taxAmount` (CA: CURRENCYTAXTOTAL; AU: TOTALCOST×TAXRATE, unrounded).
   - The "Currency Tax" column uses CURRENCYTOTALTAX (unrounded).
   - The home tax total is the PO-level `po.totalTax`, not a sum.

7. **Totals are computed by summing lines,** not from po.totalCost. The vendor-currency total is Σ(UNITCOST/rate×qty) and is not rounded per line in the US.

8. **The UOM conversion join is effectively a no-op:** `uom.id = poitem.uomId` is both the from- and to-UOM, so the COALESCE(…,1) factor is 1.

9. **USCURRENCYUNITCOST / USTOTALCOST / CAUnitCost round the foreign-currency value to 2 decimals before multiplying back by the rate.** Home-currency figures on multi-currency POs can therefore differ slightly from the stored ones.

10. **Formatting inconsistencies:**
    - In the Currency Total columns the foreign value uses the **TotalsDecimal** pattern but the home fallback uses **CostDecimal**.
    - Fields whose expression returns a String ignore `patternExpression`.
    - When `isMultiCurrency` is false, the expressions return a raw Double, formatted by the CostDecimal pattern.

11. **Default visible item columns total 553pt**, 1pt wider than the 552 column. Hidden columns collapse and the rest shift left. There is no auto-widening of Description.

12. **Zebra uses `$V{PAGE_COUNT}`** inside the table dataset, so shading restarts on each page: row 1 of every page is white.

13. **Fishbowl preprocessing:**
    - FieldTitle and other string parameters arrive as "%" when unset.
    - `CustomField:*` values are raw SQL fragments injected with `$P!{}`. For the rebuild, use `customfieldbyname(po.customfields,'<Name>')` / `poitem.customfields`, or NULL when unset.
    - Boolean defaults `"PropertyMulti Currency"` / `"PropertyNotMulti Currency"` resolve from the company's multi-currency flag.

14. **Java helpers the rebuild must reimplement:**
    - `ReportHelperModule.getCompanyReportAddress(locationGroupId, showCountry)`, which returns styled text.
    - `ReportHelperModule.getImageData("Company",1,true)` + `ImageUtil.decodeImage`, for the logo bytes.
    - `CurrencySymbolConst.getFormattedCurrency(symbolId:int, value:double, pattern)` and `.getConstant(id).getSymbol()`. Symbol fields are integer ids; 91 is the hard-coded fallback.
    - `AccountingModule.isInternational/isCa/isAu`, `CurrencyModule.isMultiCurrency`, `PropertyUtil.isCaOrInternational`.
    - System properties: REPORT_DATE_FORMAT, REPORT_DECIMAL_COST / _TOTAL / _QTY / _PRICE, "PO Notice", "Barcodes have DI".

15. **Column visibility conditions are evaluated in the main report's context.** That is why `OrderDateScheduled` (main only) and `$F{CURRENCYCODE}` / `$V{isMultiCurrency}` in the totals columns resolve to main-report values.

16. **Totals sit in lastPageFooter**, so they are bottom-anchored (page y 654–772).
    - If the items end too low on what would be the last page, JasperReports pushes the footer to a new page that contains only the page header and the footer.
    - Non-last pages show only the 14pt footer.

17. **Item table header and column headers repeat on every page.** Group headers (addresses, notes, info strip) print once, on page 1 only. The page header (logo, title, order #, date, barcode) repeats on every page.

18. **The tax label and value fields in the totals are declared 1pt high** and rely on stretch-with-overflow. The Total row is Float, so in the US it stays at y=1 and keeps a 1pt top gap.

19. **The memo subreport uses a hard-coded memo table id `"397076832"`** (string) and `recordID = PO.ID`. Memos sort by memo id, and the date uses REPORT_DATE_FORMAT.

20. **The JRXML declares unused items:**
    - Variables PartInfo, priceDecimalNoSymbol, costDecimalNoSymbol, QBVERSION.
    - Parameters dateRangeNone, REPORTDESCRIPTION, OrderFulfillmentDate, ShowItemFulfillmentDate, AddTaxIntegrationEstimatedTaxToTotal.
    - ItemTaxCode, ItemTax and ItemCurrencyTax have no effect in the US.
