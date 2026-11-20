# Fill PDF forms

**Status:** Available in the browser, no upload.  
**Route:** `/tools/pdf-forms`  
**Code:** `src/lib/pdf-forms.ts`, `src/components/pdf-forms.tsx`

## What it does

- Opens a PDF with standard AcroForm fields.
- Lists text fields, checkboxes, radio groups, dropdowns and option lists.
- Lets the user fill them and optionally flatten the result.
- Downloads a filled PDF.

## Limits

- 25 MB per PDF.
- 500 pages.
- 500 fields.
- Text values are capped at 10,000 characters.
- XFA forms, signature fields and non-AcroForm visual forms are not supported.
- Flattening removes the interactive fields and makes their appearance permanent.

## Privacy

The PDF is read and saved with pdf-lib in the browser. Nothing is uploaded.

## Tests

- Unit: `src/lib/pdf-forms.test.ts` (inspection, text/checkbox fill, flatten verification).
- Browser: `e2e/pdf-forms.spec.ts` (create a form, fill it, download and reopen it).
