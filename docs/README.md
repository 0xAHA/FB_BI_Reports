# Developer guides

For the development team taking on this repo. Start with **building-apps**;
CLAUDE.md is the BI runtime's API reference and the repo's working rules.

| Guide | Read it when you |
|---|---|
| [building-apps.md](building-apps.md) | build any new report, document or tool: the templates, the libraries, printing, identity, deploying |
| [porting-ireport.md](porting-ireport.md) | port a stock Fishbowl iReport (.jrxml) to a faithful BI report |
| [fb-doc.md](fb-doc.md) | work on a PDF view, a record document, report options or paper (the fb-doc engine) |
| [app-builder-models.md](app-builder-models.md) | extend the App Builder's catalog (subjects, fields, measures) |
| [launch-context.md](launch-context.md) | open a report from a module (report_btn's `FB_LAUNCH`, document output `FB_DOC`) |
| [dashboards-review.md](dashboards-review.md) | take on the dashboards (`Dashboards/`): what they are, what they depend on, the options |

Elsewhere:

- [`iReport_Ports/README.md`](../iReport_Ports/README.md): every port, by
  folder; [`iReport_Ports/DIFFERENCES.md`](../iReport_Ports/DIFFERENCES.md):
  every deviation from the stock reports, for review.
- [`schema/schema-index.md`](../schema/schema-index.md): the database.
- [`scripts/README.md`](../scripts/README.md): the shared assets and their
  deploy order.
- [`tools/deploy/README.md`](../tools/deploy/README.md): deploying to
  Fishbowl and publishing to SharePoint;
  [`tools/report-harness/README.md`](../tools/report-harness/README.md):
  running reports on recorded data;
  [`tools/doc-tests/README.md`](../tools/doc-tests/README.md): the record
  documents' tests.
- [`Other_NOT_FOR_PRODUCTION/report_btn/README.md`](../Other_NOT_FOR_PRODUCTION/report_btn/README.md):
  the client plugin (Apps menus, the App editor, document output).

Claude Code skills (`.claude/skills/`) walk through the common jobs:
`create-bi-app`, `port-ireport-report`, `add-printable-view`,
`extend-app-builder-model`, `fishbowl-bi-save-error`.
