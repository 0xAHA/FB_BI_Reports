# Fishbowl BI Reports Collection

A collection of custom BI Reports and themes for Fishbowl Inventory Management, designed to streamline common inventory operations and provide enhanced reporting capabilities.

## Table of Contents
- [Installation](#installation)
- [Report Index](#report-index)
- [Themes](#themes)

---

## Installation

### Prerequisites
- Fishbowl Inventory Management System
- Access to the Reporting > BI Editor menu

### Step 1: Install Styling Themes

The themes must be installed **first** before importing any reports, as the reports depend on these stylesheets.

1. In Fishbowl, open **Reporting > BI Editor** menu
2. Click **Import**
3. Select the theme file (`.json` format):
   - `fishbowl-theme.css`
   - `fishbowl-theme-modern.css`
4. Ensure that you tick the **"Publish"** checkbox
5. Select appropriate **None/View/Edit** settings for each User Group
6. Click **OK**

Repeat for both theme files.

### Step 2: Import BI Reports

After themes are installed, import the desired report(s):

1. In Fishbowl, open **Reporting > BI Editor** menu
2. Click **Import**
3. Select the report's `.json` file
4. Ensure that you tick the **"Publish"** checkbox
5. Select appropriate **None/View/Edit** settings for each User Group
6. Click **OK**

### Step 3: Using Reports

To open a report:

1. Open the **Reporting** module
2. Select **BI Report**
3. Double-click the report in the list

**Tip:** Where available, use the **Instructions** flyout on the report for information about the report's purpose and usage.

---

## Report Index

| Report File | Report Name | Purpose |
|-------------|-------------|---------|
| `Assembly_Disassembly_Helper.htm` | Assembly Disassembly Helper | Automates disassembly of sub-assemblies and reassembly into finished products using JSON configuration |
| `Cycle_Count_Helper.htm` | Cycle Count Helper | Prepares cycle count inventory adjustments with CSV export |
| `Default_Parts_Updater.htm` | Default Parts Location Manager | Manages and updates default locations for parts in bulk |
| `Inv_Reorder_Watchlist.htm` | Inventory Reorder Monitor | Monitors inventory levels and reorder points with visual status indicators |
| `Inventory_Adjustment_Helper.htm` | Inventory Adjustment Helper | Prepares complex inventory adjustments with IN/OUT tracking and cost balancing |
| `Inventory_Availability_by_Location_Group.htm` | Inventory Availability by Location Group | Displays inventory availability organized by location groups |
| `PPP_Pricing_Validator.htm` | Part, Product & Vendor Pricing Validator | Validates pricing data from Excel/CSV imports |

---

## Themes

### fishbowl-theme.css

Classic Fishbowl theme with official Fishbowl branding colors (#2D9CDB).

**Used by:** Inventory Reorder Monitor, Inventory Availability by Location Group, Assembly Disassembly Helper, Cycle Count Helper, Inventory Adjustment Helper

### fishbowl-theme-modern.css

Modern Bootstrap 5-based theme with enhanced UI components and responsive design.

**Used by:** PPP Pricing Validator, Default Parts Updater

---

## Additional Resources

### Assembly Disassembly Helper Configuration

The Assembly Disassembly Helper uses a JSON configuration file. See [README_Assembly_JSON.md](README_Assembly_JSON.md) for detailed documentation on:
- JSON structure and field descriptions
- Example configurations
- Workflow and usage instructions

**JSON File Location:** `C:\Program Files\Fishbowl\server\reports\Custom\Assembly.json`

### Example Files

- **assembly_disassembly_example.json** - Example JSON configuration template
- **theme-demo.html** - Demo of classic theme styles and components
- **theme-demo-modern.html** - Demo of modern theme styles and components

---

## Notes

- Always install themes before importing reports
- Some reports include built-in Instructions flyouts with usage information
- Report documentation will be expanded as features are added

---

## Version History

See git commit history for detailed version information and changes.
