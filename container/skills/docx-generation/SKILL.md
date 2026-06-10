---
name: docx-generation
description: Generate Word (.docx) documents using the pre-installed docx library. Use when the user asks to create a Word document, letter, report, or any .docx file.
---

# Word Document Generation

The `docx` npm package is pre-installed. Use it to generate .docx files.

## Quick Reference

```js
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';
import fs from 'fs';

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      new Paragraph({
        text: "Document Title",
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: "Bold text", bold: true }),
          new TextRun(" and normal text."),
        ],
      }),
      new Paragraph({
        text: "A bullet point",
        bullet: { level: 0 },
      }),
    ],
  }],
});

const buffer = await Packer.toBuffer(doc);
fs.writeFileSync("/workspace/group/output.docx", buffer);
```

## Key Rules

1. Always save to `/workspace/group/` so it can be sent via `mcp__nanocrab__send_file`
2. Use `Packer.toBuffer()` (not `toBlob()` — no browser APIs in Node)
3. After generating, send the file:
   ```
   mcp__nanocrab__send_file({ filePath: "/workspace/group/output.docx", filename: "document.docx" })
   ```

## Common Patterns

- **Tables**: `import { Table, TableRow, TableCell }`
- **Images**: `import { ImageRun }` with `fs.readFileSync()` for the image data
- **Page breaks**: `new Paragraph({ children: [], pageBreakBefore: true })`
- **Headers/Footers**: Set in `sections[].headers` and `sections[].footers`
