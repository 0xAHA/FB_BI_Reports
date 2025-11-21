# Assembly Disassembly Helper - JSON Format

## Overview
This tool reads a JSON configuration file to automatically populate inventory adjustments for building finished products by:
1. Disassembling sub-assemblies into components
2. Using those components (plus additional direct components) to build the finished product

## File Location
The tool reads from a hardcoded file path:
```
C:\Program Files\Fishbowl\server\reports\Custom\Assembly.json
```

Place your `Assembly.json` file in this location before using the tool.

## Workflow

When you select a product to build:

**Phase 1 - DISASSEMBLE:**
- OUT: Sub-assembly items (via Cycle Count)
- IN: Their component parts (via Add Inventory)

**Phase 2 - ASSEMBLE:**
- OUT: All components - from disassemble + direct components (via Cycle Count)
- IN: Finished PRODUCT (via Add Inventory)
- **Cost adjustment happens here** to ensure the finished product has correct costing

## JSON Structure

```json
{
  "products": [
    {
      "partNumber": "FINISHED-PROD-001",
      "description": "Finished Product Assembly A",
      "quantity": 1,
      "disassemble": [
        {
          "item": "SUB-ASSEMBLY-A",
          "description": "Sub Assembly A",
          "quantity": 1,
          "components": [
            {
              "partNumber": "COMP-001",
              "description": "Component Part 1",
              "quantity": 2
            }
          ]
        }
      ],
      "components": [
        {
          "partNumber": "COMP-005",
          "description": "Component Part 5",
          "quantity": 3
        }
      ]
    }
  ],
  "metadata": {
    "description": "Assembly Disassembly Configuration",
    "version": "2.0"
  }
}
```

## Field Descriptions

### Product (The finished good you want to build)
- `partNumber` (required): Finished product part number matching your Fishbowl system
- `description` (optional): Product description
- `quantity` (required): Number of finished products to build
- `disassemble` (optional): Array of sub-assemblies to break down
- `components` (required): Array of direct components needed for the product

### Disassemble Items (Sub-assemblies to break down)
- `item` (required): Sub-assembly part number
- `description` (optional): Sub-assembly description
- `quantity` (required): Quantity of this sub-assembly needed per product
- `components` (required): Array of components that this sub-assembly contains

### Components (Parts needed)
- `partNumber` (required): Component part number
- `description` (optional): Component description
- `quantity` (required): Quantity needed (will be multiplied by parent quantity)

## How It Works

1. **Load JSON**: Click "Load Assembly.json" button to load from the hardcoded path
2. **Select Product**: Choose which product to build from the dropdown
3. **Auto-Population**:
   - **OUT items (Cycle Count):**
     - Sub-assemblies (from disassemble section)
     - All components (from disassemble.components + product.components)
   - **IN items (Add Inventory):**
     - Components from disassembled sub-assemblies
     - Finished PRODUCT
4. **Review & Adjust**:
   - Average costs are loaded from database
   - Locations are auto-selected
   - **Adjust the cost on the finished PRODUCT** to account for any discrepancy
   - Use "Auto-Apportion" button to distribute cost discrepancy proportionally
5. **Export**: Generate separate CSV files for Cycle Count and Add Inventory imports

## Example Use Case

You want to build 1× FINISHED-PROD-001, which requires:
- Disassembling 1× SUB-ASSEMBLY-A (contains 2× COMP-001, 1× COMP-002)
- Plus 3× COMP-005 direct components

```json
{
  "products": [
    {
      "partNumber": "FINISHED-PROD-001",
      "quantity": 1,
      "disassemble": [
        {
          "item": "SUB-ASSEMBLY-A",
          "quantity": 1,
          "components": [
            {"partNumber": "COMP-001", "quantity": 2},
            {"partNumber": "COMP-002", "quantity": 1}
          ]
        }
      ],
      "components": [
        {"partNumber": "COMP-005", "quantity": 3}
      ]
    }
  ]
}
```

This will create:
- **OUT (Cycle Count):**
  - 1× SUB-ASSEMBLY-A
  - 2× COMP-001
  - 1× COMP-002
  - 3× COMP-005
- **IN (Add Inventory):**
  - 2× COMP-001 (from disassemble)
  - 1× COMP-002 (from disassemble)
  - 1× FINISHED-PROD-001 (final product - adjust cost here!)

## Cost Adjustment

The key feature is adjusting the cost of the finished PRODUCT (IN item) so that:
- Total OUT cost = Total IN cost (discrepancy = $0.00)
- The finished product absorbs any cost differences from the disassembly/assembly process
- Use the "Auto-Apportion Discrepancy" button to automatically balance costs

## Files

- `Assembly_Disassembly_Helper.htm` - Main HTML tool
- `assembly_disassembly_example.json` - Example JSON with placeholder parts
- Edit the example JSON with your actual part numbers from Fishbowl and copy to the server path
