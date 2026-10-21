# Label tests

Desk tests for `scripts/fb-label.js`.

```
node --test tools/label-tests/word.test.js
```

- **`word.test.js`** checks `FBLabel.word`, which turns a Word label template
  (Avery and the like) into a sheet setup, in the vm with no browser. It covers:
  - Avery J8162 from both its `.doc` and its `.docx`, which must give the same
    setup;
  - spacer columns and rows becoming the gaps;
  - files that aren't Word files.
- **`samples/`** holds the label makers' Word templates the tests read. Git
  ignores the folder (the files aren't ours to share), and a test whose file is
  missing is skipped. To add one, drop a template there and add its expected
  sizes, taken from the label maker's own spec, to `word.test.js`.
