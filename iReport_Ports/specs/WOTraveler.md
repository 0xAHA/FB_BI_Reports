# Fishbowl stock Work Order Traveler (WOTraveler.jrxml): implementation spec for an HTML rebuild

**Sources read**
- `C:\Program Files\Fishbowl\server\reports\WorkOrder\WOTraveler.jrxml` (2458 lines). This is the only file the WO Traveler actually uses.
- `C:\Program Files\Fishbowl\server\reports\WorkOrder\subWOTracking.jrxml` and `subBOMInstructions.jrxml`. **Neither is referenced by WOTraveler.jrxml or the compiled WOTraveler.jasper, or by any other .jrxml/.jasper in the reports tree.** They are leftovers from an older version. The current report gets all its child data from five `jr:table` components fed by internal `subDataset`s. The orphans are summarised in §6.6.
- `C:\Program Files\Fishbowl\server\reports\Batch\ByOrder\WOTravelerByOrder.jrxml` and `C:\Program Files\Fishbowl\server\reports\ManufactureOrder\MOTraveler.jrxml`. MO relationship is in §9.
- I also ran a few read-only queries against the live Fishbowl DB (ireport-mcp) to confirm type and status IDs and the system-property values.

**Engine:** Fishbowl 26.5 runs JasperReports 5.6.0.1 with Java expressions. The JR property `net.sf.jasperreports.evaluator.ignore.npe` defaults to true, so **any expression that throws a NullPointerException evaluates to null and prints blank**. Several behaviours below depend on this.

---

## 1. PAGE

**Page geometry**
- US Letter portrait: pageWidth 612, pageHeight 792 (pt).
- Margins: left/right/top/bottom all 20.
- columnWidth 572. One column.
- Printable area runs x 20..592 and y 20..772. All x/y values below are relative to the margin origin (20,20).
- `whenNoDataType="AllSectionsNoDetail"`.

**Bands in use**
- Bands present but empty/zero height: background, title, columnFooter, summary.
- There is **no `<detail>` band and no `<columnHeader>` band at all.**

**Fonts and colours**
- Font is "Open Sans" on every element.
  - Some elements carry `pdfFontName="Helvetica-Bold"`/`"Helvetica"` and `pdfEncoding` hints. These are irrelevant when the Open Sans extension is installed.
  - When no size is given, size is 10.
- Colours:
  - Text is black.
  - Section strips and header-cell fills are `#EAEAEA`.
  - Light row separators are `#CCCCCC`.
  - Hyperlink text is `#000099`.
  - Some cells have 1pt white (`#FFFFFF`) left/right pens. These are invisible on white, so ignore them.

**Line height**
- JR "Single" spacing uses the font metrics. For Open Sans, line height ≈ 1.362 × font size:
  - 8pt ≈ 10.9
  - 9pt ≈ 12.26
  - 10pt ≈ 13.62
  - 11pt ≈ 15.0
  - 14pt ≈ 19.1
  - 17pt ≈ 23.2
- Use `line-height: 1.362` to match stretch heights.
- In JR, a tab character (`\t`) advances to the next 40pt tab stop.

**Vertical flow on each page (the order JR prints)**
1. **pageHeader**: 162pt, can grow. Printed on **every** page with the same WO data.
2. **Group "Notes" header**: 28pt+. Only if the WO note is non-empty.
3. **Group "FinishedGoods" header**, which has 3 bands printed in this order:
   - a. "BOM Instructions" band (44pt+), only if `cbShowInstructions == "bom"`
   - b. "WO Instructions" band (46pt+), only if `cbShowInstructions == "wo"`
   - c. "Finished Goods" band (59pt+), always printed
4. **Group "RawGoods" header**: 46pt+, always printed.
5. **pageFooter**: 14pt, at the bottom of every page (y 738..752 relative, i.e. absolute y 758..772).

The instructions section therefore prints **above** Finished Goods. Body space per page is 752 − 162 − 14 = 576pt (less if the header grows). Table column headers repeat at the top of each new page when a table splits across pages.

---

## 2. PARAMETERS

### (a) Record ID

There is only one record parameter: **`woNum`**.

| name | class | default | prompting | notes |
|---|---|---|---|---|
| `woNum` | java.lang.String | `"%"` | **yes** (the only prompting param) | The WO **number** string (e.g. `"1234:001"`). There is no woId parameter. |

How `woNum` is used:
- Main query: `wo.num LIKE $P{woNum}`.
- headerInfo dataset: `wo.num LIKE $P{woNum}` with `LIMIT 1`.
- finishedGoodsInfo and rawGoodsInfo datasets: **exact** `wo.num = $P{woNum}`. All three receive it through `$P{REPORT_PARAMETERS_MAP}`.
- WO instructions are keyed by the main-query field `$F{woid}`, passed as dataset param `woid`.
- BOM instructions are keyed by the main-query field `$F{BOMNUM}`, passed as dataset param `bomNum`.
- The Work Order module and the batch wrapper both pass the WO number.

### (b) Option parameters

All are `isForPrompting="false"`. Booleans are `java.lang.Boolean`. Fishbowl shows these on the report Options/Columns tabs.

| name | class | default | effect |
|---|---|---|---|
| `cbShowInstructions` | String | `"none"` | parameterDescription `none,None,wo,Work Order Instructions,bom,BOM Instructions`. `"bom"` shows the BOM Instructions band; `"wo"` shows the WO Instructions band; `"none"` shows neither. |
| `ShowBarcode` | Boolean | true | Shows the barcode in the header. |
| `DisplayTime` | Boolean | false | Shows the start and finish time fields next to the scheduled dates. |
| `ShowCategory` | Boolean | true | Shows the "Category:" text in the header. |
| `ShowCategoryColor` | Boolean | true | Appends the colour swatch after the category name. |
| `ShowPageFooter` | Boolean | true | Shows all 3 footer fields. The batch wrapper passes false. |
| `ShowTimeStamp` | Boolean | true | **Unused** (no reference). |
| `ReportTitle` | String | *(none)* | Title text (see §5 for the null/"%" handling). |
| `colPart#` | Boolean | true | FG and RG "Part #" column. |
| `colDescription` | Boolean | true | FG and RG "Description" column. |
| `colBOMQty` | Boolean | true | FG and RG "BOM Qty" column. |
| `colWOQty` | Boolean | true | FG and RG "WO Qty" column. |
| `colFinished` | Boolean | true | FG "Finished" column. |
| `colUsed` | Boolean | true | RG "Used" column. |
| `colScrapped` | Boolean | true | RG "Scrapped" column. |
| `colHeader:Priority` | Boolean | true | Header-table "Priority" column. |
| `colHeader:CustomerJob` | Boolean | true | Header-table "Customer Job" column. |
| `colHeader:WOQty` | Boolean | true | Header-table "WO Qty" column. |
| `colHeader:Class` | Boolean | true | Header-table "Class" column **and also the "Status" column** (bug). |
| `colHeader:Location` | Boolean | true | Header-table "Location" column. |
| `colHeader:Status` | Boolean | true | **Unused.** The Status column is wired to `colHeader:Class`. |
| `colBOMInstructions:Order` | Boolean | true | BOM-instructions "Order" column. |
| `colBOMInstructions:Name` | Boolean | true | "Name" column. |
| `colBOMInstructions:Description` | Boolean | true | "Description" column. |
| `colBOMInstructions:Details` | Boolean | true | "Details" column. |
| `colBOMInstructions:URL` | Boolean | true | "URL" column. |
| `colWOInstructions: Step` | Boolean | true | **Note the space after the colon** in all `colWOInstructions:` names. Controls the "Step" column. |
| `colWOInstructions: Instructions` | Boolean | true | "Instructions" column. |
| `colWOInstructions: Ready` | Boolean | true | "Ready" column (two variants, see §6.3). |
| `colWOInstructions: Completed` | Boolean | true | "Completed" column. |
| `colWOInstructions: Status` | Boolean | true | "Status" column. |
| `colWOInstructions: URL` | Boolean | **false** | Adds the URL column and switches to the narrower Ready/Completed/Status variants. |
| `ShowWOInstructionDetails` | Boolean | false | Prints instruction details under each instruction. |
| `ShowWOInstructionCompleted` | Boolean | false | Prints qtyfulfilled in the Completed column. Otherwise the column is a blank write-in. |
| `ShowWOInstructionStatus` | Boolean | false | Prints the status icon when an instruction is done. |

### (c) System and internal parameters

| name | class | default | notes |
|---|---|---|---|
| `REPORTDESCRIPTION` | String | `"Basic Report for Work Orders."` | Metadata only. |
| `dateRangeNone` | java.util.Date | none | Unused. |
| `module` | java.lang.Object | null | Fishbowl `com.evnt.eve.modules.ReportHelperModule`, used for 2 helper calls. |
| `path` | String | `"../WorkOrder/"` | Unused. |

Built-ins used: `REPORT_CONNECTION`, `REPORT_PARAMETERS_MAP` (forwards **all** main params by name into every table dataset), `COLUMN_COUNT`, `PAGE_NUMBER`.

**JVM System properties** (Fishbowl loads them from the `sysproperties` table; values shown are from this install):

| property | value here | used for |
|---|---|---|
| `REPORT_DATE_FORMAT` | `dd/MM/yyyy` (US default `MM/dd/yyyy`) | All date fields. |
| `REPORT_DECIMAL_QTY` | `#,##0.#####` | All quantity fields. |
| `REPORT_DECIMAL_PRICE` / `REPORT_DECIMAL_COST` | `$ #,##0.00` | Declared but unused. |
| `"Barcodes have DI"` | `"true"` | Adds the "W" prefix (see barcode). |

**Parameters declared only inside sub-datasets** (values arrive by name from `REPORT_PARAMETERS_MAP`):
- finishedGoodsInfo: `ShowInstructions` (Boolean true, unused).
- headerInfo: `colCustomerJob` (Boolean true, unused).
- BOMInstructionsInfo:
  - `bomNum` (String "%")
  - `path` (String `"C:/Fishbowl/Server/reports/WorkOrder/"`, unused)
- WOInstructionsInfo: `woid` (String "%").

---

## 3. MAIN QUERY (verbatim)

```sql
SELECT 	WO.NUM AS WONUM, BOM.NUM AS BOMNUM, BOM.DESCRIPTION AS DESCRIPTION, WO.NOTE AS WONOTE, COMPANY.NAME AS COMPANY, SO.BILLTONAME AS CUSTOMERNAME,
	SO.SHIPTONAME, SO.SHIPTOADDRESS, SO.SHIPTOCITY, SO.SHIPTOZIP, PRIORITY.NAME AS PRIORITY, MO.NUM AS MONUM,
	TIME(WO.DATESCHEDULEDTOSTART) AS STARTTIME, TIME(WO.DATESCHEDULED) AS ENDTIME, WO.DATESCHEDULEDTOSTART,
	WO.DATESCHEDULED AS DATESCHEDULEDFINISH,customer.name AS customerJob, qbclass.name AS class, wostatus.name AS woStatus,
	CONCAT(locationgroup.name, '-', location.name) AS location, calcategory.name AS calcat, so.num AS sonum, wo.id AS woid,
    	IF(calcategory.color IS NOT NULL, CONCAT("<style backcolor='#",calcategory.color,"'><style forecolor='#",calcategory.color,"'>"), '') AS catcolor

FROM 	wo
    	INNER JOIN woitem ON wo.id = woitem.woid
    	LEFT JOIN wostatus ON wostatus.id = wo.statusid
    	LEFT JOIN priority ON wo.priorityid = priority.id
    	LEFT JOIN customer ON wo.customerid = customer.id
    	INNER JOIN moitem ON woitem.moitemid = moitem.id
    	LEFT JOIN bom ON moitem.bomid = bom.id
    	LEFT JOIN mo ON moitem.moid = mo.id
    	LEFT JOIN so ON mo.soid = so.id
    	INNER JOIN company on company.id = 1
    	LEFT JOIN locationgroup ON wo.locationgroupid = locationgroup.id
    	LEFT JOIN location ON wo.locationid = location.id
    	LEFT JOIN qbclass ON wo.qbclassid = qbclass.id
    	LEFT JOIN calcategory ON wo.calcategoryid = calcategory.id

WHERE 	wo.num LIKE $P{woNum}
```

The query returns one row per woitem, with **no ORDER BY**. Only the first row is effectively used (see §4).

**Fields** (class → used where):
- `WONUM` String → WO # box, barcode, ORDERNUMBER.
- `BOMNUM` String → "BOM:" line and its print condition; bomNum for the BOM-instructions table.
- `DESCRIPTION` String (bom.description) → line under BOM.
- `WONOTE` String → Notes band.
- `COMPANY` String → top-left company name.
- `CUSTOMERNAME` String (so.billToName) → Customer line.
- `SHIPTONAME`, `SHIPTOADDRESS`, `SHIPTOCITY`, `SHIPTOZIP` String → **unused**.
- `PRIORITY` → unused here (the header table has its own query).
- `MONUM` → **unused** (the MO number is never printed).
- `STARTTIME` java.sql.Time and `ENDTIME` java.sql.Time → time fields.
- `DATESCHEDULEDTOSTART` Timestamp and `DATESCHEDULEDFINISH` Timestamp → scheduled dates.
- `customerJob`, `class`, `woStatus`, `location` → unused (the header table re-queries them).
- `calcat` → Category text.
- `sonum` → "SO#:" line.
- `woid` Integer → woid for the WO-instructions table.
- `catcolor` String → category colour markup.

---

## 4. VARIABLES and GROUPS

### Main-report variables
- **`ORDERNUMBER`** (String, default reset Report, calc Nothing):
  ```java
  $V{barcodehavedi} == null ?
      $F{WONUM} :
      $V{barcodehavedi}.equals("true") ?
          "W" + $F{WONUM} :
          $F{WONUM}
  ```
- **`barcodehavedi`** (String): `System.getProperty("Barcodes have DI")`
- `DateFormat`, `CostDecimal`, `QtyDecimal`, `PriceDecimal` (String, resetType None): `System.getProperty("REPORT_DATE_FORMAT" / "REPORT_DECIMAL_COST" / "REPORT_DECIMAL_QTY" / "REPORT_DECIMAL_PRICE")`
- `rowCount` (Integer, expression `0`): unused.

Every sub-dataset declares the same `QtyDecimal`/`PriceDecimal`/`CostDecimal` (and `DateFormat` in headerInfo and WOInstructionsInfo) variables. finishedGoodsInfo and rawGoodsInfo each have `rowCount` (DistinctCount of WOITEMID), which is unused.

### Main-report groups
None of the group footers has content; each is an empty 0-height band.

1. **`Notes`**
   - groupExpression is empty (null), so it is constant and the header prints once, at report start.
   - Header: 1 band, height 28, splitType Stretch.
   - printWhen: `new Boolean(($F{WONOTE} != null) && (!$F{WONOTE}.equals("")))`
2. **`FinishedGoods`**
   - groupExpression `1`, so it prints once.
   - Header has 3 bands: 44 (BOM instructions), 46 (WO instructions), 59 (Finished Goods). Details in §5.
3. **`RawGoods`**
   - groupExpression `1`, so it prints once.
   - Header: 1 band, height 46, splitType Stretch.

Because there is no detail band and every group expression is constant, each section prints exactly once using the **first** row of the main query. The remaining rows are iterated silently. The page header on later pages also shows first-row values. The barcode has evaluationTime=Report, so it uses the last row's ORDERNUMBER, which is the same WO.

### Sub-dataset groups (these drive table group-header rows)
- **finishedGoodsInfo**: `WOItem` (expr `$F{WOITEMID}`) is the outer group; `TrackingItem` (expr `$F{TRACKVALUE}`) is the inner group.
- **rawGoodsInfo**: `WOITEMID` (expr `$F{WOITEMID}`) is the outer group; `TrackingItem` (expr `$F{TRACKVALUE}`) is the inner group.

Each FG/RG item therefore renders three things in order:
1. An item row (outer group header).
2. A tracking row (inner group header).
3. One detail row per data row:
   - The data rows are duplicated by the `LEFT JOIN parttotracking`, so there is one per tracking type, minimum 1.
   - FG detail height is 1pt, so FG items get N × 1pt of extra blank space.
   - RG detail height is 0.

---

## 5. BANDS AND ELEMENTS

Coordinates are x, y, w, h in pt, relative to the band. "Stretch" means `isStretchWithOverflow=true`. "BWN" means `isBlankWhenNull`. Unless stated otherwise: positionType FixRelativeToTop, transparent, no border, left/top alignment.

### 5.1 pageHeader

Height 162, splitType Stretch, no printWhen. Elements in top-to-bottom, left-to-right order:

1. **Company name** (textField, key textField-2)
   - Geometry: 0, 0, 378, 20.
   - Font: 14 bold. Left aligned, vertical Top.
   - Stretch, BWN.
   - Expression: `$F{COMPANY}`
   - This is the only company info. There is **no logo, no address**.
2. **"WO #" label** (staticText)
   - Geometry: 379, 1, 125, 17.
   - Opaque, backcolor #EAEAEA. Border 0.5 on all sides.
   - Font: 10 bold. Center/Middle.
   - Text: `WO #`
3. **"Date" label** (staticText)
   - Geometry: 504, 1, 69, 17. This runs to x=573, 1pt past the column.
   - Opaque #EAEAEA, border 0.5 on all sides.
   - Font: 10 bold. Center/Middle.
   - Text: `Date`
4. **Report title** (textField, key staticText-1)
   - Geometry: 0, 18, 378, 25. It overlaps the bottom 2pt of the company name.
   - Font: 17 bold. Left/Middle. markup none.
   - Expression: `$P{ReportTitle}.equals("%") ? "Work Order Traveler" : $P{ReportTitle}`
   - In stock JR, a null ReportTitle throws an NPE, so the title prints blank.
   - Rebuild rule: if ReportTitle is null, empty, or "%", print "Work Order Traveler".
5. **WO number value** (textField)
   - Geometry: 379, 18, 125, 17.
   - Border 0.5 on all sides; padding left 3, right 3.
   - Font: 11 bold. Center/Middle.
   - Stretch, BWN.
   - Hyperlink: type Reference, anchor `"WONum"`, reference `$F{WONUM}`. This link is meaningless and can be ignored.
   - Expression:
     ```java
     System.getProperty("Barcodes have DI") == null ?
         $F{WONUM} :
         System.getProperty("Barcodes have DI").equals("true") ?
             "W" + $F{WONUM} :
             $F{WONUM}
     ```
6. **Print date value** (textField)
   - Geometry: 504, 18, 69, 17.
   - Border 0.5 on all sides.
   - Font: 10 regular. Center/Middle.
   - Stretch, BWN.
   - Expression: `new Date()`. Pattern: `$V{DateFormat}`.
7. **"BOM:" line** (textField, key textField-1)
   - Geometry: 1, 43, 377, 21.
   - Font: 10, the whole string is **bold**. Left/Middle.
   - Stretch, BWN.
   - printWhen: `new Boolean($F{BOMNUM} != null)`
   - Expression: `"BOM: " + $F{BOMNUM}`
8. **Barcode** (componentElement, barbecue)
   - Geometry: 378, 43, 195, 39. positionType **Float**.
   - Style "Barcode": hAlign Right, vAlign Middle. The bars are right-aligned in the box.
   - printWhen: `$P{ShowBarcode}`
   - Settings: type **Code128B**, drawText **false** (no human-readable text), checksumRequired false, barWidth 0 and barHeight 0 (both auto), evaluationTime **Report**.
   - Code: `$V{ORDERNUMBER}`
9. **BOM description** (textField, key textField-1)
   - Geometry: 1, 64, 377, 18.
   - Font: 10 regular. Left/Top.
   - Stretch, BWN.
   - printWhen: `new Boolean($F{BOMNUM} != null)`
   - Expression: `$F{DESCRIPTION}`
10. **Customer / SO line** (textField, key textField-4)
    - Geometry: 0, 82, 378, **1**. positionType **Float**.
    - Stretch, and **not** BWN.
    - Font: 10. markup **styled**. Left/Middle.
    - printWhen: `$F{CUSTOMERNAME} != null`
    - Expression:
      ```java
      "<b>Customer: </b>" + $F{CUSTOMERNAME} +
      "\n" + "<b>SO#: </b>" + $F{sonum}
      ```
    - Output is two lines: bold "Customer: " followed by so.billToName, then bold "SO#: " followed by so.num.
    - It only appears when the WO's MO is linked to an SO.
    - It grows to about 27.2pt (2 × 13.62).
11. **"Scheduled Start:" label** (staticText)
    - Geometry: 0, 91, 92, 14. Float.
    - Right padding 3. Font: 10 bold. Left/Top.
    - Text: `Scheduled Start:`
12. **Scheduled start date** (textField)
    - Geometry: 92, 91, 62, 14. Float.
    - Padding left 3, right 3. Font: 10. Left/Top.
    - Stretch, BWN.
    - Expression: `$F{DATESCHEDULEDTOSTART}`. Pattern: `$V{DateFormat}`.
13. **Start time** (textField)
    - Geometry: 154, 91, 133, 14. Float.
    - Left padding 3. Font: 10. Left/Top. Not BWN.
    - Pattern: `h:mm a` (e.g. "8:00 AM").
    - printWhen: `$P{DisplayTime}`
    - Expression: `$F{STARTTIME}`
14. **"Scheduled Finish:" label** (staticText)
    - Geometry: 0, 105, 92, 14. Float.
    - Right padding 3. Font: 10 bold.
    - Text: `Scheduled Finish:`
15. **Scheduled finish date** (textField)
    - Geometry: 92, 105, 62, 14. Float.
    - Padding left 3, right 3. Font: 10. Top.
    - BWN, **not** stretch.
    - Expression: `$F{DATESCHEDULEDFINISH}`. Pattern: `$V{DateFormat}`.
16. **End time** (textField)
    - Geometry: 154, 105, 133, 14. Float.
    - Left padding 3. Font: 10.
    - Pattern: `h:mm a`.
    - printWhen: `$P{DisplayTime}`
    - Expression: `$F{ENDTIME}`
17. **Category** (textField)
    - Geometry: 287, 105, 285, 14. **Not** Float.
    - Padding left 3. Font: 10 regular. **Right**/Middle. markup **styled**.
    - Stretch, BWN.
    - printWhen: `$P{ShowCategory}`
    - Expression:
      ```java
      "<b>Category: </b>" + ($F{calcat}.equals("") ? "" : $F{calcat}) + ($P{ShowCategoryColor} ? " " + ($F{calcat}.equals("") ? "" : ($F{catcolor} + "    ." + "</style></style>")) : "")
      ```
    - If calcat is null, the NPE is swallowed and the **whole field is blank**, including the "Category:" label.
    - Otherwise it prints bold "Category: " plus the name.
    - If ShowCategoryColor is on, it then adds a space and a colour swatch. The swatch is 4 spaces plus "." with backcolor = forecolor = `#`+calcategory.color (stored without '#', e.g. `3399FF`). That makes a solid block about 13pt wide and one line tall, at the right edge.
18. **Header info table** (componentElement jr:table, key "table")
    - Geometry: 0, 127, 572, 28. positionType **Float**.
    - Dataset: headerInfo. Details in §6.1.
    - Renders a 14pt grey header row and a 14pt value row (y 127..155), leaving a 7pt gap to the band bottom.

**Float behaviour**
- A Float element keeps its original gap below any element above it that overlaps it horizontally, even when that element grows.
- When the Customer line prints, it grows by about 26pt. That pushes elements 11–16 and the table down by about 26pt, and the band grows to about 188pt:
  - Start row moves to ≈117.
  - Finish row moves to ≈131.
  - Table moves to ≈153.
- Category (17) does **not** move.
- The barcode floats only if the WO # box above it grows.
- If the Customer line is absent, nothing collapses. Its 1pt slot simply stays empty.

### 5.2 Group Notes header

Band height 28, splitType Stretch.
printWhen: `new Boolean(($F{WONOTE} != null) && (!$F{WONOTE}.equals("")))`

1. **Title strip** (staticText-7)
   - Geometry: 0, 0, 572, 14. Float.
   - Opaque #EAEAEA. Left padding 5.
   - Font: 10 bold. Vertical Top (no vertical alignment is set).
   - Text: `Notes:`
2. **Note text** (textField-13)
   - Geometry: 0, 14, 572, 14. Float.
   - Left padding 5. Font: 10. Vertical Middle.
   - Stretch, BWN.
   - Expression: `$F{WONOTE}` (plain text, multi-line).

### 5.3 Group FinishedGoods header, band 1: BOM Instructions

Height 44, splitType Stretch.
printWhen: `$P{cbShowInstructions}.equals("bom")`

1. **Title strip** (staticText-26)
   - Geometry: 0, 0, 572, 14. Float.
   - Opaque #EAEAEA. Left padding 5.
   - Font: 10 bold. Middle.
   - printWhen: `$V{COLUMN_COUNT}.intValue() < 1 ? new Boolean(true) : new Boolean(false)`. This is always true here (see §8).
   - Text: `BOM Instructions`
2. **Table "BOM Instructions Table"**
   - Geometry: 0, 14, 572, 30.
   - Dataset: BOMInstructionsInfo. Details in §6.2.

### 5.4 Group FinishedGoods header, band 2: WO Instructions

Height 46.
printWhen: `$P{cbShowInstructions}.equals("wo")`

1. **Title strip** (staticText-26)
   - Geometry: 0, 0, 572, 14. Float.
   - Opaque #EAEAEA. Left padding 5.
   - Font: 10 bold. Middle.
   - printWhen: the same COLUMN_COUNT expression as in 5.3.
   - Text: `WO Instructions`
2. **Table "WO Instructions Table"**
   - Geometry: 0, 14, 572, 32.
   - Dataset: WOInstructionsInfo. Details in §6.3.

### 5.5 Group FinishedGoods header, band 3: Finished Goods

Height 59, no printWhen, so it always prints.

1. **Title strip** (staticText-26)
   - Geometry: 0, **7**, 572, 14. There is a 7pt gap above it.
   - Float. Opaque #EAEAEA. Left padding 5.
   - Font: 10 bold. Middle.
   - printWhen: the same COLUMN_COUNT expression.
   - Text: `Finished Goods`
2. **Table "table"**
   - Geometry: 0, 21, 572, 31.
   - stretchType RelativeToBandHeight, isRemoveLineWhenBlank.
   - Dataset: finishedGoodsInfo. Details in §6.4.
   - Nominally there is a 7pt gap below the table.

### 5.6 Group RawGoods header

Height 46, splitType Stretch, no printWhen.

1. **Title strip** (staticText-26)
   - Geometry: 0, 0, 572, 14. Float.
   - Opaque #EAEAEA. Left padding 5.
   - Font: 10 bold. Middle.
   - No printWhen.
   - Text: `Raw Goods`
2. **Table "table"**
   - Geometry: 0, 14, 572, 32.
   - stretchType RelativeToBandHeight.
   - Dataset: rawGoodsInfo. Details in §6.5.

### 5.7 pageFooter

Height 14, splitType Stretch. All three fields:
- printWhen `$P{ShowPageFooter}`
- Font 9, vertical **Bottom**, BWN

Fields:
1. **Timestamp**
   - Geometry: 0, 0, 341, 14. Left aligned.
   - Expression: `(DateFormat.getDateTimeInstance(DateFormat.LONG,DateFormat.LONG)).format(new Date())`
   - This is the server JVM's locale-dependent long date and time with time zone. On a Java 21 en_US server it looks like "October 12, 2026 at 3:04:05 PM MDT"; older JVMs omit "at".
2. **Page label**
   - Geometry: 341, 0, 183, 14. **Right** aligned.
   - Expression: `"Page " + $V{PAGE_NUMBER} + " of "`
3. **Total pages**
   - Geometry: 524, 0, 48, 14. Left aligned.
   - evaluationTime **Report**, i.e. the total page count.
   - Expression: `"" + $V{PAGE_NUMBER}`

Together fields 2 and 3 read "Page 1 of 3".

---

## 6. CHILD DATA ("subreports" = table components with sub-datasets)

All five tables:
- use `connectionExpression $P{REPORT_CONNECTION}`;
- use `parametersMapExpression $P{REPORT_PARAMETERS_MAP}`, so every main param reaches the dataset by name;
- shift remaining columns left when a column's printWhen is false, so the table becomes narrower than 572;
- repeat their column header row on each new page.

### 6.1 headerInfo (page-header table, at 0,127)

No extra dataset params. `woNum` comes from the map.

**Query (verbatim):**
```sql
SELECT 	COALESCE(sysproperties.sysvalue,'Instructions') AS title, wo.num AS woNum, wo.qtyOrdered, priority.name AS priority,
	wostatus.name AS woStatus, CONCAT(locationgroup.name, '-', location.name) AS location, wo.datescheduledToStart,
	wo.datescheduled AS datescheduledFinish, customer.name AS customerJob, calcat.name AS calCat, qbclass.name AS class,
	wo.id AS woid, TIME(wo.datescheduledToStart) AS starttime, TIME(wo.datescheduled) AS endtime

FROM 	wo
	LEFT JOIN priority ON wo.priorityid = priority.id
	LEFT JOIN wostatus ON wostatus.id = wo.statusid
	LEFT JOIN locationgroup ON wo.locationgroupid = locationgroup.id
	LEFT JOIN location ON wo.locationid = location.id
	LEFT JOIN customer ON wo.customerid = customer.id
	LEFT JOIN calcategory AS calcat ON wo.calcategoryid = calcat.id
	LEFT JOIN qbclass ON wo.qbclassid = qbclass.id
	LEFT JOIN sysproperties ON sysproperties.syskey = 'BOMInstructionsName' AND sysproperties.readallowed = 1
	LEFT JOIN WOINSTRUCTION AS WOI ON WOI.WOID = WO.ID

WHERE 	wo.num LIKE $P{woNum}

LIMIT 1
```

**Fields:**
- `title` String
- `woNum` String
- `qtyOrdered` Integer (wo.qtyOrdered is INT)
- `priority` String
- `woStatus` String
- `location` String
- `datescheduledToStart` Timestamp
- `datescheduledFinish` Timestamp
- `customerJob` String
- `calCat` String
- `class` String
- `woid` Integer
- `starttime` Time
- `endtime` Time

Only priority, customerJob, qtyOrdered, class, location and woStatus are displayed.

**Layout**
- Column header row, 14pt high:
  - Cell box: 0.5 border on all sides.
  - Static text: opaque #EAEAEA, padding left 2 / right 2, font 10 bold, centered, vertical Top.
- Detail row, 14pt high:
  - Cell box: 0.5 border on all sides.
  - Text field: padding left 2 / right 2, font 9, centered, vertical Top (WO Qty is Middle), Stretch, BWN.

**Columns, left to right:**

| # | header text | width | x | printWhen | value |
|---|---|---|---|---|---|
| 1 | `Priority` | 95 | 0 | `$P{colHeader:Priority}` | `$F{priority}` |
| 2 | `Customer Job` | 95 | 95 | `$P{colHeader:CustomerJob}` | `$F{customerJob}`, i.e. customer.name from wo.customerId |
| 3 | `WO Qty` | 95 | 190 | `$P{colHeader:WOQty}` | `$F{qtyOrdered}`, pattern `$V{QtyDecimal}`, vertical Middle |
| 4 | `Class` | 95 | 285 | `$P{colHeader:Class}` | `$F{class}` |
| 5 | `Location` | 97 | 380 | `$P{colHeader:Location}` | `$F{location}`. This is `LocationGroup-Location`; if the WO has no location, CONCAT is NULL and the cell is blank. |
| 6 | `Status` | 95 | 477 | **`$P{colHeader:Class}`** (bug) | `$F{woStatus}` (Entered / Started / Fulfilled) |

### 6.2 BOMInstructionsInfo (only when cbShowInstructions = "bom")

Extra datasetParameter: `bomNum = $F{BOMNUM}`, taken from the main query's first row.

Table `whenNoDataType` is the default (Blank):
- If BOMNUM is null, the table prints nothing, but the "BOM Instructions" title strip still prints.
- If the BOM exists but has no instruction items, the LEFT JOIN returns 1 row: you get the header plus one empty 14pt row.

**Query (verbatim):**
```sql
SELECT	bom.num AS bomnum,
	bom.description AS bomdescription,
	bii.name AS instructname,
	bii.description AS biidesc,
	bii.details, bii.sortorder,
	bii.url

FROM 	bom
    	LEFT JOIN bominstructionitem bii ON bii.bomid = bom.id

WHERE 	bom.num = $P{bomNum}

ORDER BY 	bii.sortorder
```

**Fields:**
- `bomnum`, `bomdescription`, `instructname`, `biidesc`, `details` (longtext): String
- `sortorder`: Integer
- `url`: String

**Layout**
- Header row, 16pt high:
  - Cell bottom border 1.0 black.
  - Static text: padding left 3, font 10 bold, vertical **Bottom**, left aligned (URL is right aligned).
- Detail row, 14pt high:
  - Cell bottom border 0.5 #CCCCCC.
  - Text field: padding left 3, font 8, vertical Middle, Stretch, BWN.

**Columns:**

| header | w | x | printWhen | value |
|---|---|---|---|---|
| `Order` | 43 | 0 | `$P{colBOMInstructions:Order}` | `$F{sortorder}` |
| `Name` | 89 | 43 | `$P{colBOMInstructions:Name}` | `$F{instructname}` |
| `Description` | 154 | 132 | `$P{colBOMInstructions:Description}` | `$F{biidesc}` |
| `Details` | 261 | 286 | `$P{colBOMInstructions:Details}` | `$F{details}` |
| header text literally **`URLoved`** (sic, also in the compiled .jasper), right aligned. In 24pt it clips; render "URL". | 24 | 547 | `$P{colBOMInstructions:URL}` | `"Link"`. Details below. |

URL column detail:
- Font 10, underline, colour #000099, right/middle.
- Hyperlink reference `$F{url}`.
- Element printWhen: `$F{url} != null && $F{url}.length() > 0`.

Table total width is 571.

### 6.3 WOInstructionsInfo (only when cbShowInstructions = "wo")

Extra datasetParameter: `woid = $F{woid}`. The value is an Integer passed into a String param; JR converts it to a string.

Table `whenNoDataType="AllSectionsNoDetail"`: the header row still prints when there are no instructions. In that case the Instructions header is blank, because `$F{title}` is null.

**Query (verbatim):**
```sql
SELECT 	woinstruction.qtyready, woinstruction.qtyfulfilled, woinstruction.sortOrder, woinstruction.name AS name, woinstruction.description,
	COALESCE(woinstruction.details,"") AS details, woinstruction.bominstructionitemid,
	COALESCE(sysproperties.sysvalue,'Instructions') as title, bominstructionitem.url

FROM 	woinstruction
	LEFT JOIN	sysproperties ON sysproperties.syskey = 'BOMInstructionsName' AND sysproperties.readallowed = 1
	LEFT JOIN bominstructionitem ON woinstruction.bominstructionitemid = bominstructionitem.id

WHERE 	woinstruction.woid like $P{woid}

ORDER BY 	woinstruction.sortOrder
```

**Fields:**
- `qtyready` Integer
- `qtyfulfilled` Integer
- `sortOrder` Integer
- `name` String
- `description` String
- `details` String
- `bominstructionitemid` Long
- `title` String
- `url` String. This is the BOM item URL, **not** woinstruction.url.

All columns sit inside one columnGroup of width 806. The columnGroup has no cells of its own.

**Layout**
- Header row, 16pt high:
  - Cell bottom border 1.0 black.
  - Text: 10 bold, vertical Middle.
- Detail row, 16pt high:
  - Cell bottom border 0.5 #CCCCCC.
  - Text: 8pt, vertical Top.

**Columns (non-URL variant, the default because `colWOInstructions: URL` = false):**

| header | w | x | printWhen | detail |
|---|---|---|---|---|
| `Step` | 31 | 0 | `$P{colWOInstructions: Step}` | `$F{sortOrder}` |
| `$F{title}` (sysproperty BOMInstructionsName, default "Instructions") | 305 | 31 | `$P{colWOInstructions: Instructions}` | Two stacked fields, described below. |
| `Ready` | 82 | 336 | `$P{colWOInstructions: Ready} && !$P{colWOInstructions: URL}` | `$F{qtyready}`, pattern QtyDecimal |
| `Completed` | 81 | 418 | `$P{colWOInstructions: Completed} && !$P{colWOInstructions: URL}` | `($P{ShowWOInstructionCompleted} && $F{qtyfulfilled} != 0) ? $F{qtyfulfilled} : ""`, pattern QtyDecimal |
| `Status` | 72 | 499 | `$P{colWOInstructions: Status} && !$P{colWOInstructions: URL}` | Blank cell plus an optional icon, described below. |

Header and detail formatting per column:
- **Step**: header is left aligned with padding left 3 / right 3. Detail has padding top 3 / left 3, Stretch, BWN.
- **Instructions**: the header is a textField with no padding, left aligned. The detail cell has two stacked fields:
  1. Geometry 0, 0, 305, 15. Padding top 3, left 3, right 3. Font 8, vertical Top. Stretch. Expression:
     ```java
     ($F{description} == null || $F{description} == "") ? $F{name} :
     ($F{name} + " - " + $F{description})
     ```
  2. Geometry 0, 15, 305, 1. Float. Padding 3 on all sides. Font **9**, vertical Middle. Stretch. Expression:
     ```java
     $P{ShowWOInstructionDetails} ? $F{details} : ""
     ```
- **Ready**: header centered. Detail centered, padding top 3 / left 3 / right 3.
- **Completed**: header centered. Detail centered, same padding.
- **Status**: header centered. The detail cell contains:
  - An empty staticText (stretchType RelativeToBandHeight, underline font). This prints nothing.
  - An image, scaleImage RealSize, hAlign Center, vAlign Top, padding top 3.
    - printWhen: `$P{ShowWOInstructionStatus} && ($F{qtyready} == 0 && $F{qtyfulfilled} > 0)`
    - Image: `((com.evnt.eve.modules.ReportHelperModule) $P{module}).getStatusIconURL(40)`, the Fishbowl status-40 ("Fulfilled") icon, roughly 16px.

**URL variant** (when `colWOInstructions: URL` = true). Step and Instructions are unchanged; the last columns are replaced:

| header | w | x | printWhen | detail |
|---|---|---|---|---|
| `Ready` | 65 | 336 | `$P{colWOInstructions: Ready} && $P{colWOInstructions: URL}` | Same as the 82pt Ready column. |
| `Completed` | 69 | 401 | `... Completed} && $P{colWOInstructions: URL}` | Same as the 81pt Completed column. |
| `Status` | 66 | 470 | `... Status} && $P{colWOInstructions: URL}` | Same as the 72pt Status column. |
| `URL` | 35 | 536 | `$P{colWOInstructions: URL}` | `($F{url} == null \|\| $F{url} == "") ? "" : "Link"`. 8pt, underline, #000099, centered/top, hyperlink `$F{url}`. |

Both variants total 571pt wide.

### 6.4 finishedGoodsInfo (Finished Goods table)

No extra params. `woNum` comes from the map.

**Query (verbatim):**
```sql
SELECT
    WOITEM.TYPEID, PART.NUM AS BOMITEMPART, WOITEM.ID AS BOMITEMID,
    PART.DESCRIPTION AS PARTDESCRIPTION, COALESCE(BOMITEM.DESCRIPTION, '') AS BOMITEMDESCRIPTION,
    (WOITEM.QTYTARGET / WO.QTYTARGET) AS BOMITEMQTY, WOITEM.QTYTARGET AS WOITEMTOTAL, TRACKINFO.TRACKVALUE AS TRACKVALUE,
    BOMITEM.SORTIDCONFIG, WOITEMUOM.CODE AS UOMCODE, WO.STATUSID AS WOSTATUS, WOITEM.ID AS WOITEMID, MOITEM.DESCRIPTION AS MODESCRIPTION

FROM wo
    INNER JOIN woitem ON wo.id = woitem.woid
    INNER JOIN moitem ON woitem.moitemid = moitem.id
    LEFT JOIN bomitem ON moitem.bomitemid = bomitem.id
    LEFT JOIN part ON woitem.partid = part.id
    LEFT JOIN uom AS woitemuom ON woitem.uomid = woitemuom.id
    LEFT JOIN parttotracking ON woitem.partid = parttotracking.partid
    LEFT OUTER JOIN (SELECT partrackinfo.partid, GROUP_CONCAT(partrackinfo.trackValue, '___', '') AS trackValue
        FROM (SELECT parttotracking.partid, GROUP_CONCAT(parttracking.abbr) AS trackValue
            FROM parttotracking
                INNER JOIN parttracking ON (parttotracking.parttrackingid = parttracking.id)
                GROUP BY parttotracking.partid, parttracking.sortorder
            ORDER BY parttracking.sortorder) AS partrackinfo
        GROUP BY partrackinfo.partid) trackinfo ON (woitem.partid = trackinfo.partid)

WHERE woitem.typeid IN (10,31)
    AND wo.num = $P{woNum}

ORDER BY COALESCE(moitem.sortidinstruct, 500)
```

Type IDs (from the bomitemtype table): 10 = Finished Good, 31 = Repair Finished Good.

**Fields:**
- `TYPEID` Integer
- `BOMITEMPART` String
- `BOMITEMID` Integer
- `PARTDESCRIPTION` String
- `BOMITEMDESCRIPTION` String
- `BOMITEMQTY` BigDecimal (per-build quantity = woitem.qtyTarget / wo.qtyTarget; NULL if wo.qtyTarget = 0)
- `WOITEMTOTAL` BigDecimal
- `TRACKVALUE` String
- `SORTIDCONFIG` Integer
- `UOMCODE` String
- `WOSTATUS` Integer
- `WOITEMID` Integer
- `MODESCRIPTION` String

TRACKVALUE looks like `"Batch#___,UseBy___"` (confirmed against live data) and is NULL for untracked parts.

All columns sit inside one columnGroup of width 572.

**Column header row (16pt):**
- Cell bottom border 1.0 black.
- Text: 10 bold, vertical **Bottom**.

| header | w | x | printWhen | header align |
|---|---|---|---|---|
| `Part #` | 100 | 0 | `$P{colPart#}` | left, indent 2 |
| `Description` | 227 | 100 | `$P{colDescription}` | left, indent 2 |
| `BOM Qty` | 75 | 327 | `$P{colBOMQty}` | center, padding left 5 |
| `WO Qty` | 75 | 402 | `$P{colWOQty}` | center |
| `UOM` | 45 | 477 | none (always shown) | center |
| `Finished` | 50 | 522 | `$P{colFinished}` | **right** |

**Item row** (WOItem group header, 14pt):
- No borders.
- Font 9, vertical Top. Stretch.

| column | expression | alignment / pattern |
|---|---|---|
| Part # | `$F{BOMITEMPART}` | left, indent 2 |
| Description | `$F{PARTDESCRIPTION}` | left, indent 2 |
| BOM Qty | `$F{BOMITEMQTY}` | center, right-indent 1, pattern QtyDecimal |
| WO Qty | `$F{WOITEMTOTAL}` | center, right-indent 1, pattern QtyDecimal |
| UOM | `$F{UOMCODE}` | center |
| Finished | `""` | blank write-in space |

**Tracking row** (TrackingItem group header, spanning all visible columns):
- Height 1, grows to fit.
- One textField: 0, 0, 572, 1. Float. Padding left 2 / right 2. **Bottom border 0.5 #CCCCCC**; this border is the row separator under every item. Font 9, Top. Stretch, BWN.
- Expression:
  ```java
  ($F{WOSTATUS}.intValue() != 40 ?
      "\t" + $F{TRACKVALUE}.replace("___", ":").replace(",","\n\t") :
      ((com.evnt.eve.modules.ReportHelperModule) $P{module}).getAllTrackingInfo("WOItem", $F{WOITEMID}))
  ```
  - If the WO is **not Fulfilled** (40), it prints one tab-indented (40pt) line per tracking type as a write-in prompt, e.g. `Batch#:` and `UseBy:`.
  - If the part has no tracking, an NPE is swallowed and the row is a blank 1pt hairline.
  - If the WO is Fulfilled, it prints the actual recorded tracking values from the server helper.

**Detail row:** 1pt, empty. There is one per query row (one per tracking type).

### 6.5 rawGoodsInfo (Raw Goods table)

No extra params.

**Query (verbatim):**
```sql
SELECT 	WOITEM.TYPEID, PART.NUM AS BOMITEMPART, WOITEM.ID AS BOMITEMID, PART.DESCRIPTION AS PARTDESCRIPTION,
	COALESCE(BOMITEM.DESCRIPTION, '') AS BOMITEMDESCRIPTION, (WOITEM.QTYTARGET / WO.QTYTARGET) AS WOITEMQTY, WOITEM.QTYTARGET AS WOITEMTOTAL,
	TRACKINFO.TRACKVALUE AS TRACKVALUE, BOMITEM.SORTIDCONFIG, WOITEMUOM.CODE AS UOMCODE, MOITEM.DESCRIPTION AS ITEMNAME, MOITEM.INSTRUCTIONNOTE,
	WO.STATUSID AS WOSTATUS, WOITEM.ID AS WOITEMID, MOITEM.DESCRIPTION AS MODESCRIPTION

FROM 	wo
    	INNER JOIN woitem ON wo.id = woitem.woid
    	INNER JOIN moitem ON woitem.moitemid = moitem.id
    	LEFT JOIN bomitem ON moitem.bomitemid = bomitem.id
    	LEFT JOIN part ON woitem.partid = part.id
    	LEFT JOIN uom AS woitemuom ON woitem.uomid = woitemuom.id
    	LEFT JOIN parttotracking ON woitem.partid = parttotracking.partid
    	LEFT JOIN	(
		SELECT partrackinfo.partid, GROUP_CONCAT(partrackinfo.trackValue, '___', '') AS trackValue
        		FROM	(
			SELECT parttotracking.partid, GROUP_CONCAT(parttracking.abbr) AS trackValue
            		FROM parttotracking
                		INNER JOIN parttracking ON (parttotracking.parttrackingid = parttracking.id)
                		GROUP BY parttotracking.partid, parttracking.sortorder
            		ORDER BY parttracking.sortorder
			) AS partrackinfo
        		GROUP BY partrackinfo.partid
		) trackinfo ON (woitem.partid = trackinfo.partid)

WHERE 	woitem.typeid != 10
    	AND wo.num = $P{woNum}
    	AND woitem.typeid != 31

ORDER BY 	COALESCE(moitem.sortidinstruct, 500)
```

This covers type 20 (Raw Good), 30 (Repair Raw Good) and 40 (Note). Labor and overhead are raw-good lines whose part type is 21 (Labor) or 22 (Overhead); they are **not** special-cased and print like any raw good.

**Fields:** as in §6.4, but the quantity field is named `WOITEMQTY`, and there are extra fields `ITEMNAME` (moitem.description) and `INSTRUCTIONNOTE` (unused).

All columns sit inside one columnGroup of width 571.

**Column header row (16pt):**
- Bottom border 1.0.
- Text: 10 bold, vertical Bottom.

| header | w | x | printWhen | header align |
|---|---|---|---|---|
| `Part #` | 100 | 0 | `$P{colPart#}` | left, indent 2 |
| `Description` | 221 | 100 | `$P{colDescription}` | left, indent 2 |
| `BOM Qty` | 75 | 321 | `$P{colBOMQty}` | **right**, padding right 10 |
| `WO Qty` | 75 | 396 | `$P{colWOQty}` | **right**, padding right 10 |
| `Used` | 50 | 471 | `$P{colUsed}` | center |
| `Scrapped` | 50 | 521 | `$P{colScrapped}` | right |

**Item row** (WOITEMID group header, **16pt**):
- No borders.
- Font 9, vertical **Middle**, transparent.

| column | content |
|---|---|
| Part # | 0, 0, 100, 16, indent 2, Stretch. Expression: `$F{TYPEID} == 40 ? "NOTE: " + $F{ITEMNAME} : $F{BOMITEMPART}` |
| Description | 0, 0, 221, 16, indent 2, Stretch. Expression: `$F{PARTDESCRIPTION}` |
| BOM Qty | Two fields in the 75pt column, both with printWhen `$F{TYPEID} != 40`: a number at 0, 0, **48**, 16, right aligned, `$F{WOITEMQTY}`, pattern QtyDecimal; and the UOM at **48**, 0, **27**, 16, left aligned, indent 2, `$F{UOMCODE}`. |
| WO Qty | The same pair: `$F{WOITEMTOTAL}` (pattern QtyDecimal) at 0/48 and `$F{UOMCODE}` at 48/27. Both have printWhen `$F{TYPEID} != 40`. |
| Used | `""`, printWhen `$F{TYPEID} != 40`. Blank write-in. |
| Scrapped | `""`, printWhen `$F{TYPEID} != 40`. Blank write-in. |

**Tracking row** (TrackingItem group header, full width):
- Height 1, grows. The **cell** has a bottom border 0.5 #CCCCCC.
- textField 0, 0, 571, 1. Float. Padding top **2**, left 2, right 2. Font 9, Top. Stretch, BWN.
- Same expression as the FG tracking row.

**Detail row:** height 0.

### 6.6 Orphan files (not used by WOTraveler)

**`subWOTracking.jrxml`** (450×144, margins 0)
- Parameter: `WOItemID` (Integer, default 51).
- Query (verbatim):
  ```sql
  SELECT woitem.ID, TrackingInfo.ID AS TrackingID, parttracking.abbr AS Title, TrackingInfo.info AS InfoString, TrackingInfo.infodate AS InfoDate,
      trackinginfosn.serialnum, trackinginfo.infodouble, trackinginfo.infointeger, parttracking.typeid

  FROM TrackingInfo
      INNER JOIN parttracking ON (TrackingInfo.parttrackingid = parttracking.id)
      LEFT JOIN woitem ON TrackingInfo.recordid = woitem.id
      LEFT JOIN wo ON woitem.woid = wo.id
      LEFT JOIN trackinginfosn ON (trackinginfo.id = trackinginfosn.trackinginfoid AND trackinginfo.parttrackingid = 4)

  WHERE TrackingInfo.tableID = '-355941248'
    AND woitem.id = $P{WOItemID}

  ORDER BY woitem.id
  ```
- A variable concatenates `Title + ": " + value + "  "`, formatted by tracking type:
  - 80 Checkbox → Yes/No. Buggy: `INFOINTEGER.equals("1")` is always false.
  - 50 Money → `¤ #,##0.00`.
  - 60 Quantity → `#,##0.#####`.
  - 70 Count → integer.
  - 20 Date / 30 Expiration Date → `MM/dd/yyyy`.
  - 40 Serial → serialnum.
  - Otherwise → info.
- The summary band prints the result in a 450×14 field, 9pt, left padding 5.
- **Useful as a SQL stand-in for `getAllTrackingInfo("WOItem", id)`** (tableId −355941248 = woitem). Fix the serial join so it uses parttracking.typeid = 40.

**`subBOMInstructions.jrxml`** (report name "BOMInstructions", 752×552 landscape)
- Query: the same as BOMInstructionsInfo, plus `INNER JOIN company ON company.id = 1` and a company field.
- Layout: page title "BOM Instructions" 16 bold centered; columns Order 61 / Name 89 / Description 178 / Details 351 / URL 73; 11pt bold headers; 10pt detail with a 0.25 grey line under each row; URL text is "URL".
- It is superseded by the §6.2 table.

---

## 7. CONDITIONAL LOGIC SUMMARY

- **Sections**
  - Notes: shown only if wo.note is non-empty.
  - BOM Instructions XOR WO Instructions: chosen by `cbShowInstructions` ("bom"/"wo"; default "none" shows neither). Printed before Finished Goods.
  - Finished Goods and Raw Goods: always printed (title strip even with no rows; a table with no rows prints nothing).
- **Item types**
  - FG table: woitem.typeId 10 (Finished Good) and 31 (Repair Finished Good).
  - RG table: everything else — 20 Raw Good, 30 Repair Raw Good, 40 Note.
  - Type 40 rows show "NOTE: " + moitem.description in Part #, and hide qty, UOM, Used and Scrapped. No type-40 woitems exist in this DB.
  - There is no separate labor/overhead section and no by-product handling beyond type 31.
  - Rows are sorted by `COALESCE(moitem.sortIdInstruct, 500)`.
- **Quantities**
  - Only targets are printed: "BOM Qty" = per-build quantity (woitem.qtyTarget / wo.qtyTarget) and "WO Qty" = woitem.qtyTarget.
  - Actual used, scrapped and finished quantities are **never** read from the DB. The Finished, Used and Scrapped columns are blank write-in spaces with no underline or boxes.
  - The header "WO Qty" = wo.qtyOrdered.
  - All quantities use the `REPORT_DECIMAL_QTY` pattern.
- **Tracking**
  - Shown as a full-width row under each item.
  - WO status ≠ 40 (Entered 10 / Started 30): write-in prompts "\t<Abbr>:" one per line.
  - WO status 40 (Fulfilled): actual values via `ReportHelperModule.getAllTrackingInfo("WOItem", woItemId)`.
  - Untracked part: an empty 1pt row that still draws the grey separator.
- **Location**: only the WO-level "LocationGroup-Location" in the header table. There are no per-item locations.
- **UOM**: FG has a separate centered UOM column (always shown). RG prints the UOM code in a 27pt slot right after each quantity.
- **Sign-off / initials**: there are no signature or initials boxes. The only write-in areas are:
  - the blank Finished / Used / Scrapped columns;
  - the tracking prompts;
  - the WO-instruction Completed and Status columns, which are blank while `ShowWOInstructionCompleted` / `ShowWOInstructionStatus` are false (the defaults).
- **Barcode**
  - One Code128B barcode with no human-readable text, right-aligned at 378,43 (195×39). Controlled by `ShowBarcode`.
  - Value is WO num, prefixed "W" when the system property "Barcodes have DI" = "true" (true on this install). The visible WO # box gets the same prefix.
- **Images**: the only image is the WO-instruction status icon (`getStatusIconURL(40)`). There are no part images, no BOM-instruction images and no logo.
- **Company**: name only, from company id=1. No address.
- **MO/SO linkage**
  - MO number is selected but **not printed**.
  - "Customer:" (so.billToName) and "SO#:" (so.num) print only when the WO's MO has an SO.
  - The header-table "Customer Job" is a different value: wo.customerId → customer.name.
- **Dates**
  - Print date (today) in the top-right "Date" box.
  - Scheduled Start = wo.dateScheduledToStart; Scheduled Finish = wo.dateScheduled. Both use `REPORT_DATE_FORMAT`.
  - Optional times (`DisplayTime`) use the `h:mm a` format.
  - Footer timestamp in long locale format.
- **Category**: shown when `ShowCategory` is on **and** wo.calCategoryId is set. Swatch shown when `ShowCategoryColor` is on.
- **Footer**: hidden when `ShowPageFooter` = false (the batch and MO wrappers do this).

---

## 8. GOTCHAS

1. **No detail band; every group expression is constant.** Each section prints once using the **first** main-query row, and the main query has no ORDER BY. BOMNUM/DESCRIPTION come from that first row's `moitem.bomId`. In this DB about 23% of raw-good moitems have a NULL bomId, so the "BOM:" line and the BOM-instructions table can vanish depending on row order. **Rebuild:** take the BOM from the moitem of the type-10 woitem, or use MAX(bom.num) across rows.
2. **The NPE-is-null rule matters in four places:**
   - Title: a null ReportTitle gives a blank title. Default it to "Work Order Traveler" when null, "" or "%".
   - Category: a null calcat blanks the whole field, label included.
   - Tracking row: a null TRACKVALUE gives an empty row.
   - A null `qtyready` makes the status-icon printWhen false.
3. **Inconsistent `woNum` matching:** the main and header queries use `LIKE`, the FG/RG tables use `=`. Running with the default "%" shows an arbitrary WO's header and empty item tables. For the rebuild, require an exact WO number.
4. **Bugs to replicate or fix:**
   - The header "Status" column is bound to `colHeader:Class`; `colHeader:Status` is ignored.
   - `ShowTimeStamp`, `colCustomerJob`, `ShowInstructions` and `path` are unused.
   - The BOM-instructions URL header text is "URLoved" in a 24pt column.
   - WO-instruction text uses `$F{description} == ""`, a Java reference comparison. An empty-string description (as opposed to NULL) prints `"Name - "`.
5. **Category colour trick:** catcolor is literal JR styled markup, `<style backcolor='#RRGGBB'><style forecolor='#RRGGBB'>`. It is followed by 4 spaces and "." (the period is there to stop the colour disappearing in PDF export, per the jrxml callout). If calcategory.color were NULL, the closing `</style></style>` would be unbalanced and JR would print the raw tags. In HTML, draw a solid inline block about 13pt wide and one line (≈13.6pt) tall instead.
6. **Styled markup:** the Customer/SO text and Category are parsed as JR styled text. HTML-escape customer names and categories that contain `&` or `<`.
7. **Tracking string build:** inner `GROUP_CONCAT(abbr)` per (part, sortOrder), then outer `GROUP_CONCAT(x,'___','')`, giving `"Lot___,Exp___"`. Java then replaces `___`→`:` and `,`→`\n\t`. An abbreviation that contains a comma would split. The GROUP_CONCAT order is not guaranteed by the derived-table ORDER BY.
8. **Server-side helpers you must reimplement:**
   - `getAllTrackingInfo("WOItem", id)`: its output format is not visible in the reports. Use the subWOTracking SQL in §6.6 (trackinginfo.tableId = −355941248, recordId = woitem.id) and format "Abbr: value" per tracking type.
   - `getStatusIconURL(40)`: the Fulfilled status icon; substitute a check icon of about 16px.
9. **System properties** come from the `sysproperties` table: `REPORT_DATE_FORMAT`, `REPORT_DECIMAL_QTY`, `"Barcodes have DI"`. Read them at runtime; do not hardcode.
10. **Hidden table columns collapse to the left** (JR table behaviour), so tables become narrower than 572 and the tracking row should span the visible width. The WO-instructions table has two alternative column sets, switched by the URL flag (§6.3).
11. **Row-height nuances:**
    - The FG item row is 14pt with Top alignment; the RG item row is 16pt with Middle alignment.
    - FG items get an extra 1pt per tracking type because of duplicate rows from `LEFT JOIN parttotracking`.
    - The RG tracking row has 2pt top padding; the FG one has none.
    - The FG separator is on the textField; the RG separator is on the cell.
12. **Section-title printWhen** `$V{COLUMN_COUNT}.intValue() < 1` is always true. Group headers are filled before the first record is counted, and they print only once.
13. **Header overlaps and overflow:**
    - Company (0..20) overlaps Title (18..43).
    - The Date boxes and the barcode run to x=573, 1pt past the column.
    - The Category field is fixed-position, so a long Customer line can overlap it near x 287–378.
    - Only the Customer line, scheduled-date rows, time fields and header table are Float.
14. **Page header repeats on every page** with first-row data, and its header table is re-queried on each page. Table column headers also repeat on page breaks.
15. **SQL arithmetic:** division by zero (`wo.qtyTarget = 0`) gives NULL, which prints blank. `woid` is passed as an Integer into a String dataset parameter (`woinstruction.woid LIKE '123'`).
16. **Location** `CONCAT(lg.name,'-',loc.name)` is NULL when the WO has no location.

---

## 9. How the MO Traveler (MOTraveler.jrxml) relates

**It is not just a loop of WO travelers.** MOTraveler is its own MO-level document:
- **Page header** (97pt): company, title `MOReportTitle` (with "%" → "Manufacture Order Traveler"), MO # / Date boxes, MO barcode, Scheduled/Started/Finished dates.
- **Column-header table**: Location Group, Class, SO #, Customer, Cust PO #.
- **Groups**:
  - `moNote`: MO note.
  - `woHeader`: a "Work Orders" strip that reprints on each page.
  - `wo` (per WONUM, keepTogether): WO #, Qty, Status, BOM (or "Custom BOM."), Location, optional Labor, dates, Priority, Category; an optional Assigned Users table; and an optional Finished Goods table with the same tracking-row logic.
- **Background**: a red 24pt watermark "Please issue the manufacture order." when the MO status is null.
- **Main query** is filtered by `mo.num LIKE $P{moNum}` and `mo.statusid > 10`, and ordered by `$P!{cbOrderBy}`.

**Optional WO travelers.** The summary band adds the WO travelers when `DisplayWOTravelers` (default **false**) is on and `!$F{MOSTATUS}.equals("Entered")`:
- It embeds `../Batch/ByOrder/WOTravelerByOrder.jasper` at x = −20, w 612.
- It passes `orderNumbers = "'" + $F{WONUMS}.replaceAll(",", "','") + "'"`, where WONUMS is a GROUP_CONCAT of all WO nums of the MO.
- It maps `colWorkOrder:*` → the WO traveler's `col*`/`colHeader:*`/`colBOMInstructions:*`/`colWOInstructions: *`, and also passes `cbShowInstructions`, `ShowBarcode`, `ShowCategory`, `ShowCategoryColor`, `WOReportTitle` and `module`.
- It has no parametersMapExpression, so `DisplayTime`, `ShowWOInstructionDetails`, `ShowWOInstructionCompleted` and `ShowWOInstructionStatus` fall back to the WO defaults.

**WOTravelerByOrder** (612 wide; margins 0 except bottom 20):
- Runs `SELECT wo.num AS WONUM FROM wo WHERE wo.num IN ($P!{orderNumbers})` with no ORDER BY.
- Its detail band contains a `runToBottom` subreport `"../WorkOrder/WOTraveler.jasper"`, so each WO starts on a new page.
- It passes `REPORT_PARAMETERS_MAP` plus `woNum=$F{WONUM}`, `ReportTitle=$P{WOReportTitle}` and `ShowPageFooter=false`.
- It prints its own footer at x=20: timestamp, then "Page N of " + total.

So the full WO Traveler documented above is rendered unchanged once per WO of the MO, after the MO-level pages.

---

## Relevant file paths
- `C:\Program Files\Fishbowl\server\reports\WorkOrder\WOTraveler.jrxml` (the spec source)
- `C:\Program Files\Fishbowl\server\reports\WorkOrder\subWOTracking.jrxml` (orphan; reference SQL for fulfilled-WO tracking values)
- `C:\Program Files\Fishbowl\server\reports\WorkOrder\subBOMInstructions.jrxml` (orphan)
- `C:\Program Files\Fishbowl\server\reports\Batch\ByOrder\WOTravelerByOrder.jrxml` (batch wrapper)
- `C:\Program Files\Fishbowl\server\reports\ManufactureOrder\MOTraveler.jrxml` (MO traveler; embeds the batch wrapper)