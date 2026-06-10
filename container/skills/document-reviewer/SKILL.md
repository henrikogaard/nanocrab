---
name: document-reviewer
description: Review PDFs, DOCX, Markdown, and reports for clarity, missing sections, risks, decisions, and action items.
triggers: document, pdf, docx, markdown, review, edit, redline, action items, decisions, clarity
examples: review this document, extract action items, check this PDF, improve this report
risk-level: medium
allowed-tools: Bash(pdftotext:*), Bash(python3:*), mcp__nanocrab__*
---

# Document Reviewer

Use this skill when reviewing or extracting value from documents.

## Workflow

1. Identify document type, audience, and goal.
2. Extract structure, decisions, risks, action items, and missing information.
3. Preserve citations, page references, headings, and source filenames.
4. Suggest edits in clear sections.
5. Ask before overwriting or exporting final documents.

