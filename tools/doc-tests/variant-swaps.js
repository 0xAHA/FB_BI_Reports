// The lines in which SOInvoiceReport.htm differs from SOReport.htm (as the old
// build.js VARIANTS): [SOReport text, SOInvoiceReport text], each exactly once.
// `body` = below the header comment; `header` = the header comment's own lines.
// The token text is built, not typed, so this file never holds a setting-token literal.
'use strict';
const TOKEN = code => String.fromCharCode(36) + code + '{';
module.exports = {
  body: [
    [TOKEN('CHECK') + 'Invoice|false|Document}', TOKEN('CHECK') + 'Invoice|true|Document}'],
    ["key:   'cdx.bi.paperwork.so',", "key:   'cdx.bi.paperwork.soinv',"],
    ["name:  'Sales Order Report',", "name:  'Sales Invoice',"],
    ['<meta name="description" content="The sales order document, ready to print or save as PDF.">',
     '<meta name="description" content="The sales invoice for a sales order, ready to print or save as PDF.">'],
    ['<title>Sales Order Report</title>', '<title>Sales Invoice</title>']
  ],
  header: [
    ['  REPORT: Sales Order Report / Sales Invoice\n  PATH:   iReport_Ports/SalesOrder/SOReport.htm',
     '  REPORT: Sales Invoice  (variant of the Sales Order Report)\n  PATH:   iReport_Ports/SalesOrder/SOInvoiceReport.htm']
  ]
};
