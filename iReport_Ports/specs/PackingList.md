# Fishbowl stock Packing List: implementation spec for an HTML rebuild

Source: `C:\Program Files\Fishbowl\server\reports\Ship\`. All coordinates are in pt.

## 0. The dispatch does not go to the files named in the brief

`PackingList.jrxml` does **not** render `SOPackingList`, `POPackingList` or `TOPackingList`. It renders the **V2** files: `SOPackingListV2.jasper`, `POPackingListV2.jasper` and `TOPackingListV2.jasper`. I confirmed this in both the jrxml (lines 619–662) and the strings inside the compiled `PackingList.jasper`.

- The V2 files have no subreports. They inline the line items and the carton list as `jr:table` components with their own subDatasets (`SOLineItems`/`POLineItems`/`TOLineItems` and `CartonInfo`).
- These inline tables are near-copies of `subSOItems`, `subPOItems`, `subTOItems` and `subCarton`.
- No stock top-level report references `SOPackingList.jasper`, `POPackingList.jasper`, `TOPackingList.jasper`, `subSOItems.jasper`, `subPOItems.jasper` or `subTOItems.jasper`. Only the orphaned legacy files call the sub* item reports.
- `subCarton.jasper` is still used, but only by the ShippingInvoice/ProForma subreports.
- The only other caller of the packing list is `Batch\ByDate\PackingListByDate.jrxml`, which calls `../Ship/PackingList.jasper`.

**So this spec treats the V2 files as what actually renders.** The legacy SO/PO/TO + sub* files differ only slightly; their differences are in §2.6.

Variant files that exist and are ignored here:
- Top level: `PackingListColorizedV1/V2/V3`, `PackingListLandscape`, `PackingListLandscapeColorized`. Each dispatches to its own `{SO,PO,TO}PackingList<Variant>` and `carton{SO,PO,TO}PackingList<Variant>`.
- Carton layouts: `cartonSOPackingList[V2]`, `cartonPOPackingList[V2]`, `cartonTOPackingList[V2]`, `subSOCartonItems`, `subPOCartonItems`, `subTOCartonItems`.
- Other: `subCartonSpecialCharacters`.

Lookup IDs, read from the live DB:

| Table | IDs |
|---|---|
| ship.ordertypeid | 1 None, 10 PO, 20 SO, 30 WO, 40 TO |
| shipstatus | 10 Entered, 20 Packed, 30 Shipped, 40 Cancelled |
| soitemtype | 10 Sale, 11 Misc Sale, 12 Drop Ship, 20 Credit Return, 21 Misc Credit, 30 Discount %, 31 Discount Amt, 40 Subtotal, 50 Assoc. Price, 60 Shipping, 70 Tax, 80 Kit, 90 Note |
| parttype | 10 Inventory, 20 Service, 21 Labor, 22 Overhead, 30 Non-Inventory, 40 Internal Use, 50 Capital Equipment, 60 Shipping, 70 Tax, 80 Misc |
| poitemtype | 10 Purchase, 11 Misc Purchase, 20 Credit Return, 21 Misc Credit, 30 Out Sourced, 40 Shipping |
| xoitemtype | 10 Send, 20 Receive |
| objecttoobjecttype | 30 Kit |

---

## 1. DISPATCH (`PackingList.jrxml`, report name "PackingSlip")

**Page:** 612 × 792 (US Letter, portrait). Margins: left 30, right 30, top 20, bottom 20. Column width 552. `whenNoDataType=AllSectionsNoDetail`.
- Every subreport is placed at x=0 of the 552-wide column. To convert to page coordinates: **absX = 30 + x**, and the first content row is at **absY = 20**.
- Styles: Open Sans, pdfEncoding Cp1252.
- Three styles are marked `isDefault` ("10", "body", "note"). JasperReports uses the last one, so **the report default is "note" = Open Sans 9pt**. Any element with no style and no explicit size renders at 9pt.

**Query:**
```sql
SELECT
    SHIP.ID AS SHIPID,
    SHIP.ORDERTYPEID AS ORDERTYPE
FROM
    ship
WHERE ship.id = $P{shipID}
```
Fields: `SHIPID` (Integer), `ORDERTYPE` (Integer).

**Bands, in render order:**

1. **Group "SOPackingList"** (expr `new Integer(1)`). Header band h=50, band printWhen `ORDERTYPE == 20`.
   - Subreport at x0 y0 w552 h50, opaque white, same printWhen.
   - Path: `$P{cbLayoutFormat}.equals("standard") ? path+"SOPackingListV2.jasper" : path+"cartonSOPackingListV2.jasper"`.
   - Parameters: `$P{REPORT_PARAMETERS_MAP}` plus `shipID = $F{SHIPID}.toString()`. Connection: `REPORT_CONNECTION`.
2. **Group "POPackingList"** (expr `null`). Header band h=50, band printWhen `ORDERTYPE == 10`.
   - Subreport: `POPackingListV2.jasper` / `cartonPOPackingListV2.jasper`. Same parameter passing.
3. **Group "TOPackingList"** (expr `null`). Header band h=50 with **no band-level printWhen**; only the subreport element has printWhen `ORDERTYPE == 40`.
   - Subreport: `TOPackingListV2.jasper` / `cartonTOPackingListV2.jasper`.
   - Because the band itself always prints, SO and PO shipments get a **blank 50pt band after their content**.
4. **Detail** band h=14, printWhen `$P{ShowDeliverySignature}` (default false):
   - **staticText** x260 y0 w100 h14. positionType FixRelativeToBottom, rightPadding 5, Right, Open Sans 10. Text: `"Receipt Signature: "`.
   - **image** x360 y0 w192 h14, scaleImage RealSize (grows to the image's natural size).
     Expression: `com.evnt.util.ImageUtil.decodeImage(((ReportHelperModule)$P{module}).getImageData("Ship", $F{SHIPID}, true))`. This is the captured delivery signature.
5. **pageFooter** h=15 (bottom of every page, absolute y 757–772). All three fields are transparent and 9pt:
   - x0 y0 w321 h15, padding L3/R3, Left/Middle: `DateFormat.getDateTimeInstance(DateFormat.LONG,DateFormat.LONG).format(new Date())`. This is the print timestamp, locale-dependent, e.g. "October 12, 2026 3:04:05 PM AEST".
   - x321 y0 w209 h15, padding L0/R4, Right/Middle: `"Page " + $V{PAGE_NUMBER} + " of"`.
   - x530 y0 w22 h15, Left/Middle, evaluationTime=Report: `$V{PAGE_NUMBER}` (the total page count).

**Dispatch rules:**
- `cbLayoutFormat` must equal `"standard"` exactly (case-sensitive). Any other value (the UI offers `"carton"`, labelled "By Carton") renders the carton layout.
- The carton layout prints one page per shipping carton and lists the items in that carton. Its SO item query joins `shipitem → shipcarton` and groups by carton with a new page per carton. Kit-header options are documented as incompatible with it.
- SO shipment → `SOPackingListV2`. PO shipment (PO Credit Return or Out Sourced lines) → `POPackingListV2`. TO shipment → `TOPackingListV2`.
- WO (30) and None (1) render nothing except the blank TO band and the footer.

**Parameter passing:** the whole parameter map is passed down. JasperReports writes evaluated defaults into the map, so **PackingList's defaults override the defaults declared in the V2 files**:

| Parameter | PackingList (effective) | SOPackingListV2's own default |
|---|---|---|
| cbOrderNumber | "SO" | "PO" |
| ShowTracking | true | false |
| PartNumDescription | false | true |

Each V2 file then passes its map on to its table datasets, together with `ShipID`, `SOID`/`POID`/`XOID` and `ShipStatus`.

### 1.1 Parameters declared in PackingList (these are the user-facing options)

**Record ID**
- `shipID` (String, default "7"). This is `ship.id`. The tooltip wrongly calls it "order number".

**System / injected**
- `path` = "../Ship/".
- `module` (Object). Fishbowl injects `com.evnt.eve.modules.ReportHelperModule` here; the default is null.
- `REPORT_CONNECTION` (built-in).
- `REPORTDESCRIPTION` = "Packing Slip for a selected order. Selecting Standard or By Location layouts will include backorder items."

**Combo boxes (cb\*).** The parameterDescription lists "value,label" pairs.

| Parameter | Default | Options |
|---|---|---|
| cbLayoutFormat | "standard" | standard, carton |
| cbOrderNumber | "SO" | SO = SO Number, PO = Customer PO Number |
| cbContactToShow | "address" | address = Address Name, contact = SO Contact |
| cbLogoAlignment | "left" | top, left |

**Checkboxes (ck\*)**, String, "checkedValue,uncheckedValue":
- `ckShowKitHeaders` "80" (unchecked = "90").
- `ckShowCountry` "1" (unchecked = "0").
- `ckShowBackOrderItems` "100" (unchecked = "101").

**Booleans**

| Parameter | Default | UI group |
|---|---|---|
| ShowUniqueShipNumbers | false | Header |
| ShowBarcode | true | Header |
| ShowCompanyName | true | Header |
| BlindShipment | false | Header; hides logo, name and company address |
| ShowTracking | true | Items |
| ShowHistoricalQtyRemaining | true | Items |
| ShowTotalQty | false | Items |
| ShowKitHeadersOnly | false | Items |
| ShowCartonInfo | true | Other Settings |
| ShowDeliverySignature | false | Other Settings |
| ShowShipmentOrderNotes | true | Other Settings |

**Column toggles** ("Hide/Show" tab):
- On by default: `LineNumber`, `PartNumber`, `Description`, `QtyOrdered`, `QtyShipped`, `QtyRemaining`.
- Off by default: `PartNumDescription`, `UnitPrice`, `TotalPrice`.

**Custom fields**
- `ShowSOCustomFields` false.
- `ShowCfSO1`..`ShowCfSO6` true.
- `CustomField:SO1`..`SO6` (String). This is a raw SQL expression chosen in the UI; Table=SO.
- `FieldTitle:SOcf1`..`6`.
- `CustomField:Item1`..`3` (Table=soitem). `ShowCfItem1`..`3` false. `FieldTitle:Itemcf1`..`3`.

**`ShowLogo`** (Boolean, default true) is declared only in the V2 files and is not exposed by PackingList, so it is effectively always true.

**FieldTitle:\* parameters** (String, no default). Fishbowl passes **"%"** when a title is left blank; every label expression is `title.equals("%") ? <default> : title`. In a rebuild, treat null, "" and "%" all as "use the default". `{C}` below means `System.getProperty("DefaultContainer","Carton")`.

| Param | Default label |
|---|---|
| Date | Date |
| Order# | Order # |
| ShipTo | Ship To: (TO: `"To: "+SHIPTOLGNAME`) |
| BillTo | Bill To: |
| ShipFrom | (TO only) `"From: "+FROMLGNAME` |
| FOBPoint | FOB Point |
| ShippingTerms | Shipping Terms |
| Carrier | Carrier |
| DateScheduled | Date Scheduled |
| CartonCount | `{C}+" Count"` |
| ShipService | Ship Service |
| OrderNum | Order Num |
| DateConfirmed | Date Confirmed (TO) |
| Type | Type (TO) |
| Owner | Owner (TO) |
| CartonInfo | `{C}+" Info"` |
| Carton# | `{C}+" #"` |
| Weight | Weight |
| LxWxH | L x W x H |
| Tracking# | Tracking # |
| TotalWeight | Total Weight: |
| Cartoncount | `{C}+" Count: "+n` (custom: `title+": "+n`) |
| Line# | `Line\n#` |
| Part# | Part # |
| Description | Description |
| QtyOrdered | `Qty\nOrdered` |
| QtyShipped | `Qty\nShipped` |
| QtyRemaining | `Qty\nRemaining` |
| UnitPrice | Unit Price |
| TotalPrice | Total Price |
| UnitCost | Unit Cost (PO) |
| TotalCost | Total Cost (PO) |
| ReportTitle | Packing Slip |
| SOcf1..6 | Custom Field 1..6 |
| Itemcf1..3 | Item CF 1..3 |
| Notes | declared but **unused** ("Notes:" is hard-coded) |

**JVM system properties used:**
- `REPORT_DATE_FORMAT`: a SimpleDateFormat pattern.
- `REPORT_DECIMAL_QTY`, `REPORT_DECIMAL_PRICE`, `REPORT_DECIMAL_COST`: DecimalFormat patterns.
- `DefaultContainer`: the container noun, default "Carton".

**DB system properties used:** `'Barcodes have DI'` and `'Default Weight UomId'`.

---

## 2. SO STANDARD PATH: `SOPackingListV2.jrxml` (report name "SOPackingSlipV2")

**Page:** 552 × 792, all margins 0, column width 552, `whenNoDataType=AllSectionsNoDetail`.
- Same style set as PackingList (default style "note", 9pt).
- Extra style **Barcode**: hAlign Center, vAlign Middle, topPadding 0.
- Extra style **Zebra**: Open Sans. Conditional on `$V{PAGE_COUNT}.intValue() % 2 == 0`: mode Opaque, backcolor `#EAEAEA`.

Font notation in this spec:
- "10b→N" means style 10b (bold) with the size overridden to N, so N-pt bold.
- Shared colours: grey header fill = **#EAEAEA**; borders are black unless stated otherwise.

### 2.1 Main query (verbatim)
```sql
SELECT
    SO.ID AS SOID,
    SHIP.ID AS SHIPID,
    SO.LOCATIONGROUPID AS LOCATIONGROUPID,
    SHIP.STATUSID AS SHIPSTATUS,
    SHIP.NOTE AS NOTE,
    SO.CUSTOMERPO AS SOCUSTOMERPO,
    COALESCE(SHIP.DATESHIPPED, CURRENT_DATE) AS SHIPDATE,
    COALESCE(SHIP.SHIPTONAME, '') AS SHIPTONAME,
    SHIP.SHIPTOADDRESS AS SHIPTOADDRESS,
    SHIP.SHIPTOCITY AS SHIPTOCITY,
    SHIPSTATE.CODE AS SHIPTOSTATE,
    SHIP.SHIPTOZIP AS SHIPTOZIP,
    SO.CUSTOMERCONTACT AS SHIPTOCONTACT,
    COALESCE(SO.BILLTONAME, '') AS BILLTONAME,
    SO.BILLTOADDRESS AS BILLTOADDRESS,
    SO.BILLTOCITY AS BILLTOCITY,
    BILLSTATE.CODE AS BILLTOSTATE,
    SO.BILLTOZIP AS BILLTOZIP,
    COALESCE(SHIP.CARTONCOUNT, 0) AS CARTONCOUNT,
    SO.DATEFIRSTSHIP AS REGSHIPDATE,
    FOBPOINT.NAME AS FOBPOINT,
    SHIPTERMS.NAME AS SHIPPINGTERMS,
    SHIP.NUM AS SHIPNUM,
    CARRIER.NAME AS CARRIERNAME,
    SO.NUM AS SONUM,
    SHIPCOUNTRY.NAME AS SHIPCOUNTRY,
    BILLCOUNTRY.NAME AS BILLCOUNTRY,
    (SELECT S1.SYSVALUE FROM SYSPROPERTIES AS S1 WHERE S1.SYSKEY = 'Barcodes have DI') AS BARCODESHAVEDI,
    COMPANY.NAME AS COMPANY,
    carrierservice.name AS carrierservice,
    $P!{CustomField:SO1} AS socf1,
	$P!{CustomField:SO2} AS socf2,
	$P!{CustomField:SO3} AS socf3,
	$P!{CustomField:SO4} AS socf4,
	$P!{CustomField:SO5} AS socf5,
	$P!{CustomField:SO6} AS socf6,
	IF(STR_TO_DATE($P!{CustomField:SO1}, '%Y-%m-%d %H:%i:%s') IS NULL, 0, 1) AS socf1DateBoolean,
	... (same for SO2..SO6) ...
	IF(STR_TO_DATE($P!{CustomField:SO1}, '%Y-%m-%d %H:%i:%s') IS NULL, NULL, $P!{CustomField:SO1}) AS socf1Date,
	... (same for SO2..SO6) ...
FROM
    ship
    INNER JOIN carrier ON ship.carrierid = carrier.id
    INNER JOIN so ON ship.soId = so.id
    INNER JOIN fobpoint ON so.fobpointid = fobpoint.id
    INNER JOIN shipterms ON so.shiptermsid = shipterms.id
    LEFT OUTER JOIN stateconst shipState ON ship.shiptostateid = shipState.id
    LEFT OUTER JOIN stateconst billState ON so.billtostateid = billState.id
    LEFT OUTER JOIN countryconst shipCountry ON ship.shiptocountryid = shipCountry.id
    LEFT OUTER JOIN countryconst billCountry ON so.billtocountryid = billCountry.id
    JOIN company ON company.id = 1
    LEFT JOIN carrierservice ON ship.carrierserviceid = carrierservice.id
WHERE
    ship.ordertypeid = 20
    AND ship.id = $P{shipID}
```
**Fields:**
- Integer: SOID, SHIPID, LOCATIONGROUPID, SHIPSTATUS.
- String: NOTE, SOCUSTOMERPO, SHIPTONAME, SHIPTOADDRESS, SHIPTOCITY, SHIPTOSTATE, SHIPTOZIP, SHIPTOCONTACT, BILLTONAME, BILLTOADDRESS, BILLTOCITY, BILLTOSTATE, BILLTOZIP, FOBPOINT, SHIPPINGTERMS, SHIPNUM, CARRIERNAME, SONUM, SHIPCOUNTRY, BILLCOUNTRY, BARCODESHAVEDI, COMPANY, carrierservice, socf1..6.
- Timestamp: SHIPDATE, REGSHIPDATE, socf1Date..6.
- Long: CARTONCOUNT.
- Boolean: socf1DateBoolean..6.

### 2.2 Variables
- **PREORDERNUMBER** = `ShowUniqueShipNumbers ? SHIPNUM : (cbOrderNumber.equals("SO") ? SONUM : (SOCUSTOMERPO null/empty ? SONUM : SOCUSTOMERPO))`.
- **CustomerPO** = `SOCUSTOMERPO non-null and non-"" ? "PO Number: " + SOCUSTOMERPO : ""`.
- **DateFormat** = `System.getProperty("REPORT_DATE_FORMAT")`.
- **ORDERNUMBER** = `BARCODESHAVEDI == null ? PRE : (BARCODESHAVEDI.equals("true") && !ShowUniqueShipNumbers ? "S" + PRE : PRE)`.

### 2.3 Band order (top to bottom)

The page header repeats on every page the subreport spans. It is followed by these group headers, each printed once: **CustomerAddresses → Notes → PackingInfo → CustomFileds → CartonInfo**, then the **Detail** band with the item table. There are no footers or summary in this file. **The carton list prints above the line items.**

#### A. pageHeader, h=134

Fixed elements:

| x,y,w,h | Type | Font | Align (H/V) | Box / back colour | Content / printWhen |
|---|---|---|---|---|---|
| 0,0,552,24 | textField, transparent | 24b→17pt **bold** | Right/Middle | none | `ReportTitle` or "Packing Slip" |
| 358,28,125,17 | textField, opaque | 9pt bold (default style) | Center/Middle | 0.5 all sides, #EAEAEA, Float | `Order#` or "Order #" |
| 483,28,69,17 | textField, opaque | 9pt bold | Center/Middle | 0.5 all sides, #EAEAEA, Float | `Date` or "Date" |
| 358,45,125,17 | textField, evaluationTime Report | 10pt bold | Center/Middle | 0.5 all sides | `$V{ORDERNUMBER}` |
| 483,45,69,17 | textField, Float, stretch, blank-when-null | 10pt regular | Center/Middle | 0.5 all sides | `SHIPDATE` with pattern `REPORT_DATE_FORMAT` |
| 358,65,194,52 | barcode (Barbecue) | n/a | style Barcode (centered) | none | **Code128B**, drawText=false, checksumRequired=false, barWidth=0 (auto), evaluationTime Report. Code = `$V{ORDERNUMBER}`. printWhen `ShowBarcode` |

Logo / company block: three mutually exclusive frames. Coordinates inside a frame are relative to the frame.

**Frame "Top Logo"** at 0,0, 358×134. printWhen `cbLogoAlignment=="top" && !BlindShipment && ShowLogo`.
- **image** 0,0,356×40, opaque white, RetainShape, hAlign left (default), vAlign Bottom, cached.
  `ImageUtil.decodeImage(module.getImageData("Company", 1, true))`. printWhen `module != null`.
- **CompanyName** 0,40,358×20, 14pt bold, vAlign Middle. `$F{COMPANY}`. printWhen `ShowCompanyName`.
- **Address** 0,60,358×64, Float, stretch, **markup="styled"**, 10pt, vAlign Top, bottomPadding 3.
  `module.getCompanyReportAddress($F{LOCATIONGROUPID})`. printWhen `module != null`.

**Frame "Left Logo"** (the default) at 0,0, 358×134. printWhen `cbLogoAlignment=="left" && !BlindShipment && ShowLogo`.
- **image** 0,0,75×134, RetainShape, hAlign Center, vAlign Middle, not cached. Same image expression and printWhen.
- **CompanyName** 75,33,283×20, leftPadding 3, 14pt bold, vAlign Top. printWhen `ShowCompanyName`.
- **Address** 75,53,283×71, Float, stretch, styled markup, 10pt, leftPadding 3, vAlign Top. printWhen `module != null`.

**Frame "Hide Logo"** at 0,28, 356×79. printWhen `!ShowLogo && !BlindShipment`.
- **Address** only: 0,0,356×64, Float, stretch, styled markup, 10pt regular, bottomPadding 3. The company name is not shown in this mode.

If `BlindShipment` is true, no frame prints, so there is no logo, name or address.

#### B. Group CustomerAddresses (expr 1), h=71

| x,y,w,h | Element |
|---|---|
| 0,0,271,17 | Opaque #EAEAEA, 14b→**10pt bold**, Left/Bottom, leftPadding 3, 0.5 box. `ShipTo` or "Ship To:" |
| 281,0,271,17 | Same styling. `BillTo` or "Bill To:" |
| 0,17,271,44 | **Ship-to box.** Stretch, 10pt, Left/Top, padding 3 on all sides, 0.5 box. printWhen `SHIPTONAME != null` (always true because of the COALESCE). Expression below. |
| 281,17,271,44 | **Bill-to box.** Same styling. printWhen `BILLTONAME != null`. Expression below. |

Ship-to expression:
```
(cbContactToShow=="address" ? SHIPTONAME : SHIPTOCONTACT) + "\n" +
(SHIPTOADDRESS ?: "") + "\n" +
(SHIPTOCITY ?: "") + ", " + (SHIPTOSTATE ?: "  ") + "  " + (SHIPTOZIP ?: "") +
(ckShowCountry=="1" ? (SHIPCOUNTRY==null ? "" : "\n"+SHIPCOUNTRY) : "") +
(CustomerPO=="" ? "" : "\n\n" + CustomerPO)
```
Bill-to expression: the same, using BILLTONAME, BILLTOADDRESS, BILLTOCITY, BILLTOSTATE, BILLTOZIP and BILLCOUNTRY, **without** the Customer PO line. In "contact" mode the bill-to box also uses **SHIPTOCONTACT** (`so.customercontact`).

The band is 71 high, so there is at least 10pt of space after the boxes.

#### C. Group Notes (expr 1), h=19

Band printWhen: `NOTE != null && NOTE.length() > 0 && ShowShipmentOrderNotes`. NOTE is **ship.note** (the shipment note).
- 0,0,33,19: staticText "Notes:", 12b→**10pt bold**, Left/Top, bottomPadding 5.
- 33,0,519,19: `$F{NOTE}`, stretch, 10pt, Left/Top, leftPadding 3, bottomPadding 5.

#### D. Group PackingInfo (expr 1), h=34. A seven-column grid.

- **Header cells:** y=7, h=14. Opaque #EAEAEA, 10b→**9pt bold**, Center/Middle, 0.5 box. The Carton Count cell also has padding L3/R3.
- **Value cells:** y=21, h=13. Transparent, **8pt** regular, Center/Middle, padding L3/R3, 0.5 box. They stretch with overflow and use stretchType RelativeToBandHeight, so all cells grow to the tallest.

| x | w | Header | Value |
|---|---|---|---|
| 0 | 78 | `{C}` + " Count" | CARTONCOUNT (ship.cartoncount) |
| 78 | 78 | Date Scheduled | REGSHIPDATE (so.datefirstship) with pattern `REPORT_DATE_FORMAT` |
| 156 | 78 | FOB Point | FOBPOINT |
| 234 | 84 | Shipping Terms | SHIPPINGTERMS |
| 318 | 78 | Carrier | CARRIERNAME |
| 396 | 78 | Ship Service | carrierservice |
| 474 | 78 | Order Num | **SONUM**, always, regardless of cbOrderNumber |

#### E. Group CustomFileds (expr SOID; the misspelling is in the source), h=36

Band printWhen `ShowSOCustomFields` (default false).
- jr:table at 0,8,552×28 on dataset "New Dataset 1". Its query is `SELECT company.name AS company FROM company WHERE company.id = 1`, which simply returns one row.
- Six columns, each 92 wide (6 × 92 = 552). Column n prints when `ShowCfSOn`. Hidden columns collapse and the remaining ones shift left.
- **Header row:** h14, opaque #EAEAEA, 10pt bold, Center/Middle, 0.5 box. Label: `FieldTitle:SOcfn` or "Custom Field n".
- **Data row:** h14, stretch, 10pt, Center (vAlign Top), 0.5 box. Value: `socfnDateBoolean ? new SimpleDateFormat(REPORT_DATE_FORMAT).format(socfnDate) : socfn`.

#### F. Group CartonInfo (expr 1), h=16. This is the inline replacement for subCarton.

Band printWhen `ShowCartonInfo` (default true).
- A horizontal line at 0,15,552×1, pen 0.5, positionType **Float**, so it lands just under the table.
- A jr:table at 0,7,552×8 on dataset **CartonInfo**, with `ShipID = SHIPID`.

Carton query (verbatim):
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
**Fields:** SHIPCARTONID (Integer), CARTONNUM (Integer), TRACKINGNUMBER (String), WEIGHT (Double), CARRIERNAME, WEIGHTUOMCODE and UOM (String), LEN, WIDTH, HEIGHT (Double).

**Variables:** `totalWeight` = Sum(WEIGHT); `totalCount` = Count(SHIPCARTONID); `QtyDecimal` = `REPORT_DECIMAL_QTY`.

The table has a single column 552 wide, with x positions inside the cell:

**tableHeader** h17:
- 0,0,552×17: 10b→**12pt bold**, vAlign Top, leftPadding 3. `CartonInfo` or `{C}` + " Info".

**columnHeader** h14. All cells are opaque #EAEAEA with a 0.5 black bottom border.

| x,y,w,h | Font | Align | Box | Label |
|---|---|---|---|---|
| 0,0,120,14 | 10pt bold | Left/Top | leftPadding 3; left and right pen 1.0 **white** | `Carton#` or `{C}`+" #" |
| 120,0,113,14 | 10pt bold | Left/**Bottom** | leftPadding 3; no white pens | `Weight` or "Weight" |
| 233,0,154,14 | 10pt bold | Left/Bottom | leftPadding 3; no white pens | `LxWxH` or "L x W x H" |
| 387,0,165,14 | 10pt bold | **Right**/Top | rightPadding 3; left and right pen 1.0 white | `Tracking#` or "Tracking #" |

**detailCell** h14, one row per carton. All fields are 10pt, vAlign Top, padding L3/R3, with a **0.25 black bottom border**.

| x,y,w,h | Content |
|---|---|
| 0,0,120,14 | `CARTONNUM.toString()`, Left |
| 120,0,113,14 | `totalWeight > 0 ? (WEIGHT + " " + WEIGHTUOMCODE) : ""`. This is a String, so the declared pattern `#,##0.#####` is ignored and the output is Java `Double.toString`, e.g. "5.0 lbs". `totalWeight` is the running sum at that row. |
| 233,0,154,14 | `DecimalFormat(QtyDecimal).format(LEN) + " " + UOM + " x " + fmt(WIDTH) + " " + UOM + " x " + fmt(HEIGHT) + " " + UOM`, Left |
| 387,0,165,14 | Tracking, when the carrier name contains "UPS": Right, **#000099, underlined**, hyperlink `http://wwwapps.ups.com/WebTracking/processInputRequest?HTMLVersion=5.0&tracknums_displayed=1&TypeOfInquiryNumber=T&loc=en_US&InquiryNumber1=<n>&track.x=Track` |
| 387,0,165,14 | Tracking, when the carrier name contains "Fed": same style, link `https://www.fedex.com/fedextrack/?trknbr=<n>` |
| **368**,0,**184**,14 | Tracking, when the carrier name contains "USPS": style Zebra but explicitly **opaque white**, #000099 underlined, link `http://trkcnfrm1.smi.usps.com/PTSInternetWeb/InterLabelInquiry.do?strOrigTrackNum=<n>`. Because it is wider and opaque, it covers x368–387 of the dimensions cell. |
| 387,0,165,14 | Tracking for any other carrier: Right, **black, not underlined**, no link |

- All tracking fields require `TRACKINGNUMBER.trim().length() > 0`. Their text is the tracking number.
- Hyperlink tooltip: `"Track My " + {C}`.

**tableFooter** h14:
- 0,0,145,14: 10pt bold, Right/Middle, no padding. `TotalWeight` or "Total Weight:".
- 145,0,242,14: 10pt bold, Left/Middle, leftPadding 3. printWhen `totalWeight > 0`. Text `totalWeight + " " + WEIGHTUOMCODE` (Double.toString).
- 387,0,165,14: 10pt bold, Right/Top, rightPadding 3, evaluationTime Report. Text: `Cartoncount=="%" ? {C}+" Count: "+totalCount : Cartoncount+": "+totalCount`.

A JR table with no rows prints nothing (default whenNoDataType=Blank), so only the line would remain.

#### G. Detail, h=35. This is the inline replacement for subSOItems.

jr:table at **0,7**, 552×28, on dataset **SOLineItems**, with `ShipID = SHIPID`, `SOID = SOID` and `ShipStatus = SHIPSTATUS` (all toString).

Line-item query (verbatim, `-- rev 6/3/2020`):
```sql
SELECT GROUP_CONCAT(IF(SHIPITEM.SHIPID = $P!{ShipID}, SHIPITEM.ID, NULL)) AS SHIPITEMID,
   SOITEM.SOLINEITEM AS SOLINEITEM,
   SOITEM.PRODUCTNUM AS PRODUCTNUM,
   SOITEM.CUSTOMERPARTNUM AS CUSTPARTNUM,
   SOITEM.DESCRIPTION AS PRODUCTDESCRIPTION,
   SOITEM.NOTE AS NOTE,
   SOITEM.QTYTOFULFILL AS QTYTOFULFILL,
   SOITEM.QTYFULFILLED AS QTYFULFILLED,
   SOITEM.QTYPICKED AS QTYPICKED,
   IF(soitem.typeid = 80, IF(soitem.qtyfulfilled = 0, soitem.qtytofulfill, soitem.qtyfulfilled), COALESCE(SUM(IF(SHIPITEM.SHIPID = $P!{ShipID}, SHIPITEM.QTYSHIPPED, 0)),0)) AS QTYSHIPPED,
     SOITEM.QTYTOFULFILL - ( IF(soitem.typeid = 80, IF(soitem.qtyfulfilled = 0, soitem.qtytofulfill, soitem.qtyfulfilled), COALESCE(SUM(IF(SHIPITEM.SHIPID = $P!{ShipID}, SHIPITEM.QTYSHIPPED, 0)),0))) - COALESCE((
      SELECT SUM(SI.QTYSHIPPED)
      FROM SHIPITEM AS SI
         JOIN SHIP AS S ON S.ID = SI.SHIPID
      WHERE S.STATUSID IN (20, 30)
         AND SI.SHIPID < $P!{ShipID} -- i can't see a situation where sequential shipments would not have sequential shipIDs
         AND SI.SOITEMID = SOITEM.ID),0) AS QTYREMAINING,
   PART.TRACKINGFLAG AS HASTRACKING,
   UOM.CODE AS UOMCODE,
   PRODUCT.WEIGHT AS PRODUCTWEIGHT,
   PART.TYPEID,
   COMPANY.NAME AS COMPANYNAME,
   SOITEM.UNITPRICE + COALESCE(SOITEM.ADJUSTAMOUNT / IF(SOITEM.QTYTOFULFILL = 0, 1, SOITEM.QTYTOFULFILL)) AS UNITPRICE,
   HOMECURRENCY.SYMBOL AS HOMECURRENCYSYMBOL,
   $P!{CustomField:Item1} AS itemcf1,
    $P!{CustomField:Item2} AS itemcf2,
    $P!{CustomField:Item3} AS itemcf3,
    IF(STR_TO_DATE($P!{CustomField:Item1}, '%Y-%m-%d %H:%i:%s') IS NULL, 0, 1) AS itemcf1DateBoolean,  (… Item2, Item3)
    IF(STR_TO_DATE($P!{CustomField:Item1}, '%Y-%m-%d %H:%i:%s') IS NULL, NULL, $P!{CustomField:Item1}) AS itemcf1Date,  (… Item2, Item3)
OBO.RECORDID2 AS KITPARENTLINE
FROM soitem
   INNER JOIN uom ON soitem.uomid = uom.id
   INNER JOIN product ON soitem.productid = product.id
   INNER JOIN company ON company.id = 1
   LEFT OUTER JOIN part ON product.partid = part.id
   LEFT OUTER JOIN shipitem ON shipitem.soItemId = soitem.id
   LEFT OUTER JOIN ship ON ship.id = shipItem.shipId
   LEFT OUTER JOIN currency AS homeCurrency ON homeCurrency.homeCurrency = 1
   LEFT JOIN objecttoobject AS obo ON obo.recordid1 = soitem.id AND obo.typeid = 30 AND obo.tableid1  = 1002104832
WHERE soitem.soid = $P!{SOID}
   AND (
      shipitem.shipID = $P!{ShipID}
      OR (CASE WHEN $P!{ckShowKitHeaders} = 80 THEN soItem.typeid = 80 AND shipitem.shipid IS NULL ELSE FALSE END)
      OR (CASE WHEN $P!{ckShowBackOrderItems} = 100 THEN soItem.typeId != 80 ELSE FALSE END)
   )
   AND soitem.typeid IN (10,30,40,50,60,70,$P!{ckShowKitHeaders})
   AND (
      part.typeid IN (10,21,22,30,40,50)
      OR (CASE WHEN $P!{ckShowKitHeaders} = 80 THEN part.typeid IS NULL END)
   )
   AND IF($P!{ShowKitHeadersOnly}, obo.recordid1 IS NULL, 1=1)
GROUP BY soItem.id
ORDER BY soitem.solineitem
```
**Fields:**
- String: SHIPITEMID (a comma list), PRODUCTNUM, CUSTPARTNUM, PRODUCTDESCRIPTION, NOTE, UOMCODE, COMPANYNAME, itemcf1..3.
- Integer: SOLINEITEM, HASTRACKING, TYPEID (this is **part** typeid; null for kit headers), HOMECURRENCYSYMBOL, KITPARENTLINE.
- Double: QTYTOFULFILL, QTYFULFILLED, QTYPICKED, QTYSHIPPED, QTYREMAINING, PRODUCTWEIGHT, UNITPRICE.
- Boolean: itemcf1..3DateBoolean. Timestamp: itemcf1..3Date.

**Dataset variables:**
- `CountCustParts` = Sum(CUSTPARTNUM non-empty ? 1 : 0).
- `PartInfo` = `(KITPARENTLINE==null ? "" : "     ") + (PRODUCTNUM==null ? "" : CUSTPARTNUM empty ? PRODUCTNUM+" - "+PRODUCTDESCRIPTION : CUSTPARTNUM+" ("+PRODUCTNUM+") - "+PRODUCTDESCRIPTION)`. The kit-child indent is 5 spaces.
- `QtyRemaining` (the non-historical value) = `ShipStatus=="30" ? QTYTOFULFILL-QTYFULFILLED : QTYTOFULFILL-QTYFULFILLED-QTYPICKED`.
- `TrackingInfo` = `(module==null || SHIPITEMID==null || HASTRACKING != 1) ? "" : module.getAllShipItemTrackingInfo("ShipItem", SHIPITEMID).replaceAll("    ","\n")`. The 4-space separators become newlines.
- `QtyShipped` = Sum(QTYSHIPPED), reset per soLineItemGroup. There is one row per line, so this equals QTYSHIPPED.
- `PriceDecimal`, `QtyDecimal`, `CostDecimal` come from the system properties.
- `isMultiCurrency` = `com.evnt.eve.modules.CurrencyModule.isMultiCurrency()`.
- `TotalQtyOrdered`, `TotalQtyShipped`, `TotalQtyRemaining` are **Integer** sums of the displayed values; kit-header rows count only when ShowKitHeadersOnly is on.

**Groups:**
- "New Column Header" (expr 1, reprinted on each page) supplies the header row.
- "soLineItemGroup" (expr SOLINEITEM) supplies the item row, which is this group's footer; the detail cell has height 0.

**Table structure, top to bottom:**
1. Column-header row: **h27**, repeats on each page.
2. One row per SO line: **h13**, stretches.
3. One-pt footnote row: a cell spanning the whole column group.
4. Table footer: **h15**, always reserved; it has content only when ShowTotalQty is on.

**Column order and widths.** Hidden columns are removed and the rest shift left; the table is left-aligned at x=0.

| # | Width | printWhen (effective default) | Header (h27) | Row cell (h13, 9pt, vAlign Top, padding L3/R3 unless noted) | Footer (h15) |
|---|---|---|---|---|---|
| 1 | 32 | LineNumber (true) | 10pt bold, Center/Bottom, "Line\n#" | `SOLINEITEM`, Center, Zebra | none |
| 2 | 90 | ShowCfItem1 (false) | 9pt bold, Center/Bottom, no padding, "Item CF 1" | Center, Zebra. Date formatted with REPORT_DATE_FORMAT if itemcf1DateBoolean, else itemcf1 | none |
| 3 | 299 | PartNumDescription (**false**) | 10pt bold, Left/Bottom, evaluationTime Report. If both titles are "%": `CountCustParts>0 ? "Item* / Description" : "Item / Description"`; otherwise (Part# title or "Number") + " / " + (Description title or "Description") | Left, Zebra: `PartInfo + ((TrackingInfo=="" \|\| !ShowTracking) ? "" : TrackingInfo) + (NOTE empty ? "" : "\n  " + NOTE)` | If ShowTotalQty: line x191 y0 w108 (1pt black) and "Total Qty: " at 0,1,299×14, Right, 10pt bold |
| 4 | 82 | PartNumber (true) | 10pt bold, Left/Bottom, "Part #" | Left, Zebra: `(KITPARENTLINE==null ? "" : "     ") + (PRODUCTNUM==null ? "" : CUSTPARTNUM empty ? PRODUCTNUM : CUSTPARTNUM+" ("+PRODUCTNUM+")")` | none |
| 5 | 217 | Description (true) | 10pt bold, Left/Bottom, "Description" | Left, Zebra: `PRODUCTDESCRIPTION + tracking (as above) + ("\n  "+NOTE)` | If ShowTotalQty: line x109 y0 w108 and "Total Qty: " at 0,1,217×14, Right, 10pt bold |
| 6 | 90 | ShowCfItem2 (false) | like column 2, "Item CF 2" | like column 2 | none |
| 7 | 73 | QtyOrdered (true) | 10pt bold, Center/Bottom, "Qty\nOrdered" | See qty-cell layout below. Number: `ShowKitHeadersOnly ? QTYTOFULFILL : (TYPEID != null ? QTYTOFULFILL : null)`. UOM: same condition, else "" | If ShowTotalQty: line 0,0,73 and `TotalQtyOrdered` at 0,1,46×14, Right, 10pt bold, evaluationTime Auto, no pattern |
| 8 | 73 | QtyShipped (true) | "Qty\nShipped" | Same layout. Number: `$V{QtyShipped}` with the same kit condition | Line plus `TotalQtyShipped` |
| 9 | 74 | QtyRemaining (true) | "Qty\nRemaining" | Shading rectangle at **x1**, w73. Number at 0,0,46: `ShowHistoricalQtyRemaining ? QTYREMAINING : $V{QtyRemaining}`, same kit condition. UOM at 46,0,**28** | Line w74 plus `TotalQtyRemaining` |
| 10 | 74 | UnitPrice (false) | "Unit Price", Center/Bottom | Shading rectangle at x1 w73. Text 0,0,74×13, Right, Zebra: `isMultiCurrency ? CurrencySymbolConst.getFormattedCurrency(HOMECURRENCYSYMBOL, UNITPRICE, PriceDecimal) : UNITPRICE` with pattern PriceDecimal | none |
| 11 | 74 | TotalPrice (false) | "Total Price" | As column 10, with `UNITPRICE * $V{QtyShipped}` | none |
| 12 | 90 | ShowCfItem3 (false) | "Item CF 3" | like column 2 | none |

**Default visible layout:** Line# 0–32, Part# 32–114, Description 114–331, Qty Ordered 331–404, Qty Shipped 404–477, Qty Remaining 477–551.

**Qty-cell layout** (columns 7–9):
- A grey (#EAEAEA) rectangle 73×13 at x0, pen 0, printWhen `PAGE_COUNT % 2 == 0`. It stretches.
- Number field: 0,0,46×13, Right, padding L3/R0, transparent, pattern `REPORT_DECIMAL_QTY`.
- UOM field: 46,0,27×13, Left, padding L3/R3, transparent, `UOMCODE`.

**Header cell styling:** opaque #EAEAEA, left and right pen **1.0 #FFFFFF** (white column separators), bottom pen 0.5 black. Padding L3/R3, except the item-CF headers, which have no padding.

**Row cell borders:** columns 1, 3 and 7–11 have a cell-level box with 1.0 white left and right pens. Columns 2, 4, 5, 6 and 12 have none.

**Footnote row** (h1, grows): textField 0,0,409×1, isRemoveLineWhenBlank, stretch, padding top 5 / left 9, Left/Bottom, 9pt. Text: `"* Part numbers in parenthesis are " + COMPANYNAME + " numbers for the part"`. printWhen `CountCustParts > 0`.

**Zebra rule:** shade a row #EAEAEA when the row's index *on the current page* is even (rows 2, 4, …). The counter restarts each page, so every page starts with an unshaded row.

### 2.4 Effective SO page skeleton (page 1, all optional parts on)

| y (relative) | Section |
|---|---|
| 0–134 | page header |
| 134–205 | addresses (boxes grow) |
| +19 | notes (grows) |
| +34 | packing info |
| +36 | SO custom fields |
| +16 and up | carton list: 7 gap, then title 17, header 14, 14 per carton, footer 14, then a 0.5 line |
| +7 gap | item table: header 27, rows 13+, footnote 1+, footer 15 |

After the subreport, the outer report adds a blank 50pt band, then the 14pt signature band if enabled. The page footer sits at absolute y 757–772. On later pages, the 134pt page header and the 27pt item-table header repeat.

### 2.5 Mapping to the files named in the brief
- `subSOItems`'s table ≡ V2 detail table.
- `subCarton` ≡ V2 CartonInfo table.

### 2.6 Legacy `SOPackingList` / `subSOItems` / `subCarton` (not rendered by stock PackingList)

The main bands are identical to V2 except:
- There is no `ShowLogo` parameter and no "Hide Logo" frame. The logo frames have no ShowLogo condition.
- Notes are controlled by `ShowOrderNotes` (default true; PackingList does not pass it) instead of `ShowShipmentOrderNotes`.
- SO custom fields print raw `$P{socfN}`, with no date formatting and no `socfNDate` fields.
- **CartonInfo band** is h15. It holds a subreport `subCarton.jasper` at 0,7,552×7 (param ShipID) and the line at y=14.
- **Detail** is a subreport `subSOItems.jasper` at 0,7,552×28 (params ShipStatus, ShipID, SOID).

`subSOItems`:
- Page 542 wide; column width 536; band h50; table at 0,0,542×50.
- Query: same as V2 but **no kit handling and no ShowKitHeadersOnly**. QTYSHIPPED is the plain sum for this shipment, and there is no OBO join, so no kit-child indent. Item custom fields are not date-formatted.
- The Part#/Desc and Description columns have no "Total Qty:" table footer.
- Declares an unused "KitTitle" style.

`subCarton`:
- A plain report: title h17, columnHeader h14 (splitType Prevent), detail h15 with fields at **y=1**, summary h14.
- **Bug:** the carton-count label uses `FieldTitle:TotalWeight` instead of `Cartoncount`.

---

## 3. PO and TO DIFFERENCES (V2 files; same page setup, styles and band structure unless stated)

### 3.1 PO: `POPackingListV2.jrxml`

Used for ship.ordertypeid = 10, i.e. vendor returns (Credit Return) and Out Sourced sends.

**Main query:**
```sql
SELECT
    PO.ID AS POID,
    PO.LOCATIONGROUPID AS LOCATIONGROUPID,
    SHIP.ID AS SHIPID,
    SHIP.STATUSID AS SHIPSTATUS,
    SHIP.NOTE AS MEMO,
    PO.VENDORSO AS SALESORDERNUMBER,
    COALESCE(SHIP.DATESHIPPED, CURRENT_DATE) AS SHIPDATE,
    SHIP.SHIPTONAME AS SHIPTONAME,
    SHIP.SHIPTOADDRESS AS SHIPTOADDRESS,
    SHIP.SHIPTOCITY AS SHIPTOCITY,
    SHIPSTATE.CODE AS SHIPTOSTATE,
    SHIP.SHIPTOZIP AS SHIPTOZIP,
    PO.REMITTONAME AS BILLTONAME,
    PO.REMITADDRESS AS BILLTOADDRESS,
    PO.REMITCITY AS BILLTOCITY,
    BILLSTATE.CODE AS BILLTOSTATE,
    PO.REMITZIP AS BILLTOZIP,
    COALESCE(SHIP.CARTONCOUNT, 0) AS CARTONCOUNT,
    PO.DATEFIRSTSHIP AS REGSHIPDATE,
    FOBPOINT.NAME AS FOBPOINT,
    SHIPTERMS.NAME AS SHIPPINGTERMS,
    CARRIER.NAME AS CARRIERNAME,
    PO.NUM AS PONUM,
    SHIPCOUNTRY.NAME AS SHIPCOUNTRY,
    BILLCOUNTRY.NAME AS BILLCOUNTRY,
    SHIP.NUM AS SHIPNUM,
    COMPANY.NAME AS COMPANY,
    (SELECT S1.SYSVALUE FROM SYSPROPERTIES S1 WHERE S1.SYSKEY = 'Barcodes have DI') AS BARCODESHAVEDI,
    SHIP.NOTE AS NOTE,
    carrierservice.name AS carrierservice
FROM
    ship
    INNER JOIN carrier ON ship.carrierid = carrier.id
    INNER JOIN po ON ship.poId = po.id
    INNER JOIN fobpoint ON po.fobpointid = fobpoint.id
    INNER JOIN shipterms ON po.shiptermsid = shipterms.id
    LEFT OUTER JOIN stateconst shipState ON SHIP.shiptostateid = shipState.id
    LEFT OUTER JOIN stateconst billState ON po.remitstateid = billState.id
    LEFT OUTER JOIN countryconst shipCountry ON SHIP.shiptocountryid = shipCountry.id
    LEFT OUTER JOIN countryconst billCountry ON po.remitcountryid = billCountry.id
    INNER JOIN company ON company.id  = 1
    LEFT JOIN carrierservice ON ship.carrierserviceid = carrierservice.id
WHERE
    ship.ordertypeid = 10
    AND ship.id = $P{shipID}
```

**Order number:** PREORDERNUMBER = `ShowUniqueShipNumbers ? SHIPNUM : (SALESORDERNUMBER empty ? PONUM : SALESORDERNUMBER)`. `cbOrderNumber` is ignored. The barcode DI prefix is **"P"**.

**Page header:** the same, except:
- The title is at **x358, w194** (still right-aligned, so it looks the same).
- The Left Logo frame is at **x=1**.
- The company address uses PO.LOCATIONGROUPID.

**Addresses:**
- Labels are still "Ship To:" and "Bill To:".
- **Both boxes print the PO Remit-To address** (BILLTO\* fields). This is a stock bug: SHIPTO\* is fetched but unused.
- There is no cbContactToShow option and no "PO Number:" line.
- The left box prints only when `SHIPTONAME != null`; it is not COALESCEd here.

**Notes:** the same, using ship.note.

**PackingInfo:**
- Header cells at **y=6**; value cells at **y=20, h=14**. Band height is 34.
- Same seven columns. Date Scheduled = po.datefirstship. **Order Num = PONUM**.

**Custom fields:** group "CustomFields" exists but has no band, so there are no SO or item custom fields.

**Carton section:** identical to SO.

**Line items:** dataset POLineItems, table at 0,7. Query:
```sql
SELECT
    SHIPITEM.ID AS SHIPITEMID,
    POITEM.POLINEITEM AS POLINEITEM,
    PART.NUM AS PARTNUM,
    POITEM.VENDORPARTNUM AS VENDORPARTNUM,
    PART.DESCRIPTION AS PARTDESCRIPTION,
    POITEM.NOTE AS NOTE,
    COALESCE(POITEM.QTYTOFULFILL, 0) AS QTYTOFULFILL,
    COALESCE(POITEM.QTYFULFILLED, 0) AS QTYFULFILLED,
    COALESCE(POITEM.QTYPICKED, 0) AS QTYPICKED,
    UOM.CODE AS UOMCODE,
    COMPANY.NAME AS COMPANYNAME,
    PART.TRACKINGFLAG AS HASTRACKING,
    COALESCE((SELECT SUM(SHIPITEM.QTYSHIPPED) FROM SHIPITEM
              WHERE SHIPITEM.SHIPID = $P{ShipID} AND SHIPITEM.POITEMID = POITEM.ID), 0) AS QTYSHIPPED,
    POITEM.TYPEID,
    POITEM.UNITCOST AS UNITCOST,
    HOMECURRENCY.SYMBOL AS HOMECURRENCYSYMBOL
FROM
    poitem
    INNER JOIN uom ON poitem.uomid = uom.id
    INNER JOIN part ON poitem.partid = part.id
    LEFT OUTER JOIN shipitem ON shipitem.shipID = $P{ShipID} AND shipitem.poItemId = poitem.id
    LEFT OUTER JOIN currency AS homeCurrency ON homeCurrency.homeCurrency = 1
    INNER JOIN company ON company.id = 1
WHERE
    part.typeid IN (10,21,22,30,40,50)
    AND poitem.typeid IN (20,30)
    AND poitem.poid = $P{POID}
    AND shipitem.shipID = $P{ShipID}
ORDER BY poitem.polineitem
```
- There is no GROUP BY, so a line split across cartons produces several records.
- Only lines on this shipment appear: `ckShowBackOrderItems`, kit and historical options are ignored.

**Variables:**
- `CountCustParts` counts VENDORPARTNUM.
- `PartInfo` = `PARTNUM==null ? "" : VENDORPARTNUM empty ? PARTNUM+"; "+PARTDESCRIPTION : VENDORPARTNUM+" ("+PARTNUM+"); "+PARTDESCRIPTION`. The separator is **"; "**, not " - ".
- `QtyRemaining` = `ShipStatus=="30" && TYPEID != 30 ? QTF-QF : QTF-QF-QPICKED`.
- `ShippingItemIDs` accumulates the SHIPITEMIDs within a line group and feeds `TrackingInfo`.
- `QtyShipped` = QTYSHIPPED.
- The totals sum QtyRemaining, QtyShipped and QTYTOFULFILL when TYPEID != null.

**Columns** (column group width 998), in order:
1. Line# 32 (POLINEITEM).
2. Part#/Desc 299.
3. Part # 82: `VENDORPARTNUM ? VENDORPARTNUM+" ("+PARTNUM+")" : PARTNUM`.
4. Description 217: PARTDESCRIPTION + tracking + note.
5. Qty Ordered 73.
6. Qty Shipped 73.
7. Qty Remaining 74. Always `$V{QtyRemaining}`; there is no historical option.
8. **Unit Cost** 74. Toggled by `UnitPrice`; header uses `FieldTitle:UnitCost`, default "Unit Cost"; shows UNITCOST.
9. **Total Cost** 74. Toggled by `TotalPrice`; header `FieldTitle:TotalCost`; shows UNITCOST × QtyShipped.

There are no item-CF columns and no kit indent. The footnote text is the same, triggered by vendor part numbers. Only the Part#/Desc, Description and three qty columns have footer content. All other cell geometry and styling is as in SO.

### 3.2 TO: `TOPackingListV2.jrxml`

Used for ship.ordertypeid = 40. There are empty `<title>` and `<columnHeader>` bands.

**Main query:**
```sql
SELECT
    XO.ID AS XOID,
    XO.FROMLGID AS FROMLGID,
    XO.SHIPTOLGID AS SHIPTOLGID,
    SHIP.ID AS SHIPID,
    SHIP.STATUSID AS SHIPSTATUS,
    SHIP.NOTE AS SHIPNOTE,
    COALESCE(SHIP.DATESHIPPED, CURRENT_DATE) AS SHIPDATE,
    SHIP.SHIPTONAME AS SHIPTONAME,
    SHIP.SHIPTOADDRESS AS SHIPTOADDRESS,
    SHIP.SHIPTOCITY AS SHIPTOCITY,
    SHIPSTATE.CODE AS SHIPTOSTATE,
    SHIP.SHIPTOZIP AS SHIPTOZIP,
    XO.FROMNAME AS FROMNAME,
    XO.FROMADDRESS AS FROMADDRESS,
    XO.FROMCITY AS FROMCITY,
    FROMSTATE.CODE AS FROMSTATE,
    XO.FROMZIP AS FROMZIP,
    XO.DATECONFIRMED AS DATECONFIRMED,
    XO.DATESCHEDULED AS SCHEDULEDDATE,
    XO.OWNERISFROM AS OWNERISFROM,
    XOTYPE.NAME AS TYPE,
    FROMLG.NAME AS FROMLGNAME,
    SHIPTOLG.NAME AS SHIPTOLGNAME,
    COMPANY.NAME AS COMPANY,
    COALESCE(SHIP.CARTONCOUNT, 0) AS CARTONCOUNT,
    CARRIER.NAME AS CARRIERNAME,
    XO.NUM AS XONUM,
    SHIPCOUNTRY.NAME AS SHIPCOUNTRY,
    FROMCOUNTRY.NAME AS FROMCOUNTRY,
    SHIP.NUM AS SHIPNUM,
    (SELECT S1.SYSVALUE FROM SYSPROPERTIES S1 WHERE S1.SYSKEY = 'Barcodes have DI') AS BARCODESHAVEDI,
    carrierservice.name AS carrierservice
FROM
    ship
    INNER JOIN carrier ON ship.carrierid = carrier.id
    INNER JOIN xo ON ship.xoId = xo.id
    INNER JOIN locationgroup fromLG ON xo.fromlgid = fromLG.id
    INNER JOIN locationgroup shipToLG ON xo.shiptolgid = shipToLG.id
    INNER JOIN xotype ON xo.typeid = xotype.id
    LEFT OUTER JOIN stateconst shipState ON ship.shiptostateid = shipState.id
    LEFT OUTER JOIN stateconst fromState ON xo.fromstateid = fromState.id
    LEFT OUTER JOIN countryconst shipCountry ON ship.shiptocountryid = shipCountry.id
    LEFT OUTER JOIN countryconst fromCountry ON xo.fromcountryid = fromCountry.id
    INNER JOIN company ON company.id = 1
    LEFT JOIN carrierservice ON ship.carrierserviceid = carrierservice.id
WHERE
    ship.ordertypeid = 40
    AND ship.id = $P{shipID}
```

**Variables:**
- PREORDERNUMBER = `ShowUniqueShipNumbers ? SHIPNUM : XONUM`. The DI prefix is **"T"**.
- `Owner` = `OWNERISFROM==1 ? FROMLGNAME : SHIPTOLGNAME`.
- `OwnerLGID` is the matching location-group ID.

**Page header:**
- Same geometry. The barcode additionally sets barHeight=0.
- Left Logo frame at x=1.
- **The company address uses `getCompanyReportAddress($V{OwnerLGID})`.**

**Addresses** (band 71):
- **Left header** 0,0,271×17: `ShipFrom=="%" ? "From: "+FROMLGNAME : ShipFrom`. No style; **12pt bold**, Left/**Top**, padding L3/R3, #EAEAEA, 0.5 box.
- **Right header** 281,0,271×17: `"To: "+SHIPTOLGNAME`, or the ShipTo title. Same styling.
- **Left box** 0,17,271×44: the **From** address (xo.from\*). printWhen `FROMNAME != null`.
- **Right box** 281,17,271×44: the **Ship To** address (ship.shipto\*). printWhen `SHIPTONAME != null`.
- Both boxes are **9pt** (no size, so default style), use the same name / address / "city, ST  zip" / optional country format, and have no contact or PO line.

**Notes:** uses SHIPNOTE. There is no bottomPadding, and the value is 9pt.

**PackingInfo** (band **35**): headers at y=7 h14, values at y=21 **h14**. Columns:

| x | w | Column | Value |
|---|---|---|---|
| 0 | 78 | Carton Count | CARTONCOUNT |
| 78 | 78 | Date Scheduled | xo.datescheduled |
| 156 | 78 | **Date Confirmed** | xo.dateconfirmed |
| 234 | 84 | **Type** | xotype.name |
| 318 | 78 | Carrier | CARRIERNAME |
| 396 | 78 | Ship Service | carrierservice |
| 474 | 78 | **Owner** | `$V{Owner}` |

There is no FOB Point, Shipping Terms or Order Num.

**Carton section:** group "cartonInfo"; the table and the line are both at **x=1**. Otherwise identical.

**Line items:** table at **x=1**, y=7. Query:
```sql
SELECT GROUP_CONCAT(SHIPITEM.ID) AS SHIPITEMID,
       XOITEM.LINEITEM AS XOLINEITEM,
       PART.NUM AS PARTNUM,
       PART.DESCRIPTION AS PARTDESCRIPTION,
       XOITEM.NOTE AS NOTE,
       COALESCE(XOITEM.QTYTOFULFILL, 0) AS QTYTOFULFILL,
       COALESCE(XOITEM.QTYFULFILLED, 0) AS QTYFULFILLED,
       COALESCE(XOITEM.QTYPICKED, 0) AS QTYPICKED,
       UOM.CODE AS UOMCODE,
       COMPANY.NAME AS COMPANYNAME,
       PART.TRACKINGFLAG AS HASTRACKING,
       COALESCE(SUM(IF(SHIPITEM.SHIPID = $P!{ShipID}, SHIPITEM.QTYSHIPPED, 0)), 0) AS QTYSHIPPED
FROM xoitem
     INNER JOIN uom ON xoitem.uomid = uom.id
     INNER JOIN part ON xoitem.partid = part.id
     LEFT OUTER JOIN shipitem ON shipitem.shipID = $P{ShipID} AND shipitem.xoItemId = xoitem.id
     INNER JOIN company ON company.id = 1
WHERE part.typeid IN (10,21,22,30,40,50)
  AND xoitem.typeid = 10
  AND xoitem.xoid = $P{XOID}
  AND shipitem.shipID = $P{ShipID}
GROUP BY xoitem.id
ORDER BY xoitem.lineitem
```

**Table structure:** a plain table, not group-based.
- Column header h**30**, with the 27-high label cell at the top, leaving a 3pt gap.
- Detail cell h13; every text cell uses the Zebra style directly.
- Cell padding is L3 only.
- No footnote, no customer part numbers, no kit handling, no price/cost columns, no custom fields.

**Columns, in this order:**
1. Line# 32: XOLINEITEM.
2. Part # 82: PARTNUM.
3. Description **218**: PARTDESCRIPTION + tracking + note.
4. Part#/Desc **300**, placed *after* Description: `PARTNUM + " - " + PARTDESCRIPTION` + tracking + note. Header "Item / Description" or the custom titles.
5. Qty Ordered 73: QTYTOFULFILL in 0–46, UOM in 46–73.
6. Qty Shipped 73: QTYSHIPPED field.
7. Qty Remaining 74: **`QTYTOFULFILL − QTYPICKED`**, number in 0–47, UOM in 47–74. The header has no right white pen.

**Totals:** "Total Qty:" footers are on the Description and Part#/Desc columns, with lines at x110 and x192 (w108). The qty totals are TotalQtyOrdered, TotalQtyShipped and TotalQtyRemaining (Integer sums).

**Default TO layout:** Line# 1–33, Part# 33–115, Description 115–333, Qty Ordered 333–406, Qty Shipped 406–479, Qty Remaining 479–553.

### 3.3 Legacy PO/TO (orphaned)
- Same as V2, except they use subreports (`subCarton`, and `subPOItems`/`subTOItems` at 0,7,552×28) and `ShowOrderNotes`.
- Carton band heights: PO 15, TO 14.
- No ShowLogo or Hide Logo frame.
- `subPOItems` has a **bug**: the Line # cell prints `SHIPITEMID` instead of POLINEITEM.
- `subTOItems` has no GROUP BY; it reads raw `SHIPITEM.QTYSHIPPED`.
- Neither legacy item subreport has the Part#/Desc and Description total footers.

---

## 4. CONDITIONAL LOGIC SUMMARY

**Show/hide**
- Header: BlindShipment hides the whole logo/name/address block.
- Logo position: `cbLogoAlignment` top/left, plus ShowLogo (always true from stock).
- `ShowCompanyName` controls the 14pt company name, which is shown only in the Top and Left frames.
- `ShowBarcode` controls the barcode.
- `ShowShipmentOrderNotes` together with a non-empty ship.note controls the Notes band.
- `ShowSOCustomFields` and `ShowCfSO1..6` control the SO custom-field strip (SO only).
- `ShowCartonInfo` controls the carton list.
- `ShowDeliverySignature` controls the outer signature band.
- `ShowTotalQty` controls the table-footer totals.
- Column toggles: LineNumber, PartNumDescription, PartNumber, Description, QtyOrdered, QtyShipped, QtyRemaining, UnitPrice, TotalPrice, ShowCfItem1..3. Hidden columns collapse leftward.
- `ckShowCountry` "1" appends the country line to both addresses.

**Which SO lines appear**
- Every line on this shipment, plus:
  - kit header lines (soitem.typeid 80) when ckShowKitHeaders = "80";
  - when ckShowBackOrderItems = "100", every other SO line of an allowed type, including ones not on this shipment (Qty Shipped 0) and ones already fully shipped earlier.
- Allowed soitem types: 10, 30, 40, 50, 60, 70, plus the kit value. The INNER JOIN on product removes product-less lines such as discounts and subtotals.
- Part types must be 10, 21, 22, 30, 40 or 50 (or null for kit headers).
- Sort: solineitem.

**Kits**
- Kit header rows have a null part TYPEID, so their quantities and UOM are blank unless ShowKitHeadersOnly is on.
- A kit header's "QTYSHIPPED" is soitem.qtyfulfilled, or qtytofulfill when that is 0. This is cumulative, not per shipment.
- Kit children are found through `objecttoobject` (typeid 30, tableid1 1002104832) and get a **5-space indent** in Part # and Part#/Desc.
- `ShowKitHeadersOnly` drops kit children and forces quantities to show on kit headers.
- PO and TO have no kit logic.

**Quantities**
- Qty Ordered = qtytofulfill.
- Qty Shipped = the sum of shipitem.qtyshipped for this shipment.
- Qty Remaining (SO, default "historical") = qtytofulfill − this shipment − earlier shipments with Packed/Shipped status and a lower ship.id.
- Alternative (ShowHistoricalQtyRemaining=false) = Shipped status ? qtytofulfill − qtyfulfilled : qtytofulfill − qtyfulfilled − qtypicked.
- PO uses the same alternative, except Out Sourced lines are always minus picked. TO = qtytofulfill − qtypicked.
- Number format: `REPORT_DECIMAL_QTY`.

**UOM**
- uom.code of the line's UOM, printed right of each quantity (27–28pt sub-cell).
- Carton weight UOM = uom.code for the sysproperty 'Default Weight UomId', falling back to 'lbs'.
- Carton size UOM = shipcarton.sizeuom.

**Lot/serial tracking**
- Shown only when `ShowTracking` (true from PackingList), module != null, part.trackingflag = 1, and the line has shipitems on this shipment.
- Text comes from `ReportHelperModule.getAllShipItemTrackingInfo("ShipItem", "<comma list of shipitem ids>")` with every 4-space run replaced by "\n".
- It is appended directly after the description, before the line note (`"\n  " + note`).

**Cartons**
- The standard layout does not group items per carton. It lists cartons separately, above the items: carton #, freight weight, L×W×H, and tracking # with a carrier-specific link.
- Totals show total weight and carton count.
- The packing-info grid's carton count is ship.cartoncount, a separate stored field.
- Per-carton item grouping exists only in the "carton" layout files.

**Barcode and order number**
- Code128B of ORDERNUMBER.
- ORDERNUMBER = ship.num if ShowUniqueShipNumbers. Otherwise:
  - SO: so.num, or so.customerpo when cbOrderNumber = "PO" and it is non-empty.
  - PO: po.vendorso, else po.num.
  - TO: xo.num.
- When sysproperty 'Barcodes have DI' = "true" and not unique-ship mode, it is prefixed "S", "P" or "T".
- The same string appears in the "Order #" box.

**Logo and company**
- Logo = `ImageUtil.decodeImage(module.getImageData("Company", 1, true))`.
- Name = company.name for id 1.
- Address = `module.getCompanyReportAddress(locationGroupId)`, styled-markup text. The location group is SO or PO locationgroupid; for TO it is the owner location group (from or to, by xo.ownerisfrom).

**Ship-to / bill-to sources**
- SO:
  - Ship-to = the shipment's ship-to (ship.shipto\*, which can differ from the SO's).
  - Bill-to = so.billto\*.
  - Name line = the address name, or so.customercontact in "contact" mode (for both boxes).
  - The ship-to box adds "PO Number: <so.customerpo>" after a blank line.
- PO: both boxes show the PO remit-to (bug).
- TO: left = xo.from\*, right = ship.shipto\*.

**Dates**
- "Date" = ship.dateshipped, or today if null.
- Date Scheduled = so/po.datefirstship (TO: xo.datescheduled).
- Format: `REPORT_DATE_FORMAT`.

**Prices** (SO, off by default)
- Unit = unitprice + adjustamount ÷ qtytofulfill (divisor 1 when qty is 0). Total = unit × shipped.
- In multi-currency mode, formatted via `CurrencySymbolConst.getFormattedCurrency(homeCurrency.symbol, value, REPORT_DECIMAL_PRICE)`.

---

## 5. GOTCHAS
1. **The real targets are the V2 files.** The legacy SO/PO/TO and sub\* item files are dead code for the stock report; see §0.
2. **Defaults come from the top-level map.** Parameters flow down via `REPORT_PARAMETERS_MAP`, so PackingList's defaults win over the V2 defaults (ShowTracking true, cbOrderNumber "SO", PartNumDescription false). `ShowLogo` is not exposed, so it stays true.
3. **"%" sentinel:** FieldTitle values of "%" mean "default label"; a null would throw in Jasper.
4. **SQL injection-style substitution.** `$P!{}` pastes text into the SO line query: ShipID, SOID, the ck\* values, `ShowKitHeadersOnly` (true/false), and `CustomField:*`. CustomField values are SQL expressions from the Fishbowl UI. Values that parse as `'%Y-%m-%d %H:%i:%s'` are treated as dates and formatted with `REPORT_DATE_FORMAT`.
5. **Helper calls**, all via `$P{module}` cast to `com.evnt.eve.modules.ReportHelperModule`, plus two static helpers:
   - `getImageData("Company",1,true)` and `getImageData("Ship",shipId,true)`, decoded with `com.evnt.util.ImageUtil.decodeImage`.
   - `getCompanyReportAddress(lgId)`, which returns styled markup.
   - `getAllShipItemTrackingInfo("ShipItem", idList)`.
   - Static: `com.evnt.eve.modules.CurrencyModule.isMultiCurrency()` and `com.fbi.sdk.constants.setup.CurrencySymbolConst.getFormattedCurrency(int, Double, String)`.
   - When `module` is null, the logo, address and tracking text silently disappear.
6. **Blank space in the outer report.** The TO group band has no band-level printWhen, so SO and PO packing lists get a 50pt blank gap before the signature band.
7. **Default style:** it is "note" (9pt), so un-sized labels render at 9pt. This applies to the Order # and Date header labels, item-CF headers, the footnote, and TO address and notes text. Elements whose style is 24b/14b/12b/10b but whose size is overridden take the override size and stay bold.
8. **Integer totals.** The Total Qty variables are `java.lang.Integer` sums, so fractional quantities are truncated row by row. They also have no number pattern.
9. **Weight text uses `Double.toString`.** Expect "5.0 lbs", and possible floating artifacts in the total.
   - Per-row weight is shown only when the *running* total is above 0, so leading zero-weight cartons show blank.
   - `WEIGHTUOMCODE` in the footer comes from the last row.
   - Null LEN/WIDTH/HEIGHT are COALESCEd to '' but declared Double; treat them as 0.
10. **Null tracking numbers.** The tracking printWhen calls `TRACKINGNUMBER.trim()`, so a null tracking number throws. Carrier detection is a substring match ("USPS", "UPS", "Fed"). The USPS field is wider (x368, w184) and opaque white, so it overlaps the dimensions column.
11. **Zebra striping** uses `$V{PAGE_COUNT} % 2` inside the table dataset, which is per-page record parity.
    - In the PO table, a line split across cartons produces multiple records. That breaks the striping and **double-counts TotalQtyShipped/Ordered/Remaining**; the row itself shows the last record.
12. **Bad qty-remaining assumption:** the SO "historical" figure assumes earlier shipments have lower ship.id values.
13. **Null unit price:** `UNITPRICE` uses single-argument `COALESCE(adjustamount/qty)`, so a NULL adjustamount makes the unit price NULL.
14. **"null" contact:** in contact mode, a null so.customercontact prints the literal text "null".
15. **PO addresses:** both boxes show remit-to (stock bug); see §3.1.
16. **Header repeats.** The subreport page header (logo, title, order #, date, barcode) and the item-table header repeat on every page. The address, notes, packing-info, custom-field and carton blocks print once, on page 1. The footer shows "Page N of M".
17. **Stale description:** `REPORTDESCRIPTION` mentions a "By Location" layout that does not exist. The only layouts are standard and carton.
