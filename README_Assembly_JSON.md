# Assembly Disassembly Helper - JSON Format

## Overview
This tool reads a JSON configuration file to automatically populate inventory adjustments for disassembling products into their component parts.

## JSON Structure

```json
{
  "assemblies": [
    {
      "product": {
        "partNumber": "PROD-001",
        "description": "Finished Product Assembly A",
        "quantity": 1,
        "location": ""
      },
      "kitItems": [
        {
          "partNumber": "COMP-001",
          "description": "Component Part 1",
          "quantity": 2,
          "location": ""
        }
      ]
    }
  ],
  "metadata": {
    "description": "Assembly Disassembly Configuration",
    "version": "1.0",
    "notes": "Optional metadata"
  }
}
```

## Field Descriptions

### Product (Items to ADD via Add Inventory)
- `partNumber` (required): Part number matching your Fishbowl system
- `description` (optional): Part description
- `quantity` (required): Number of finished products to add
- `location` (optional): Location - will be auto-populated from default location

### KitItems (Items to REMOVE via Cycle Count)
- `partNumber` (required): Component part number matching your Fishbowl system
- `description` (optional): Part description
- `quantity` (required): Quantity of this component per product (will be multiplied by product quantity)
- `location` (optional): Location - will be auto-populated from locations with stock

## How It Works

1. **Upload JSON**: Click "Load JSON File" button and select your configuration file
2. **Auto-Population**:
   - Products are added to IN items (Add Inventory section)
   - Kit components are added to OUT items (Cycle Count section)
   - Quantities are automatically calculated (kitItem qty × product qty)
3. **Review & Adjust**:
   - Average costs are loaded from database
   - Locations are auto-selected
   - You can manually adjust costs to achieve $0.00 discrepancy
   - Use "Auto-Apportion" button to distribute cost discrepancy proportionally
4. **Export**: Generate separate CSV files for Cycle Count and Add Inventory imports

## Example Use Case

If you want to disassemble 2 units of "PROD-001" (which contains 3× COMP-A and 1× COMP-B):

```json
{
  "assemblies": [
    {
      "product": {
        "partNumber": "PROD-001",
        "quantity": 2
      },
      "kitItems": [
        {
          "partNumber": "COMP-A",
          "quantity": 3
        },
        {
          "partNumber": "COMP-B",
          "quantity": 1
        }
      ]
    }
  ]
}
```

This will:
- Add 2× PROD-001 to Add Inventory
- Remove 6× COMP-A (3 per product × 2 products) via Cycle Count
- Remove 2× COMP-B (1 per product × 2 products) via Cycle Count

## Files

- `Assembly_Disassembly_Helper.htm` - Main HTML tool
- `assembly_disassembly_example.json` - Example JSON with placeholder parts
- Edit the example JSON with your actual part numbers from Fishbowl
