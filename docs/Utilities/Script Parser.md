---
tags: [utilities]
---

# Script Parser

**File**: `src/utils/scriptParser.ts`

Extracts structured text from multiple file formats for scene planning.

## Supported Formats

| Format | Extension | Library/Method |
|--------|-----------|----------------|
| Plain text | `.txt` | Direct read |
| Markdown | `.md` | Strip frontmatter, extract text |
| Word | `.docx` | `mammoth` |
| PDF | `.pdf` | `pdf-parse` |
| Rich text | `.rtf` | Custom text extraction |

## Output

Returns raw text string (no structure). The [[Scene Planner]] LLM handles all structural interpretation.

## Fallback

If parsing fails, attempts generic text extraction. Throws descriptive error for unsupported formats.

See also: [[Scene Planner]], [[Orchestrator]]
