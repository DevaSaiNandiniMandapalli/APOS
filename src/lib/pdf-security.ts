import { PDFDocument } from "@cantoo/pdf-lib";
import { checkPdfHeader, PDF_LIMITS } from "./pdf-limits";

function validateInput(bytes: Uint8Array) {
  if (!bytes.byteLength) throw new Error("Choose a non-empty PDF.");
  if (bytes.byteLength > PDF_LIMITS.perFileBytes) throw new Error("The PDF exceeds the 50 MB input limit.");
  if (!checkPdfHeader(bytes)) throw new Error("This file does not have a PDF signature.");
}

export async function protectPdf(bytes: Uint8Array, userPassword: string, ownerPassword: string) {
  validateInput(bytes);
  if (userPassword.length < 12 || ownerPassword.length < 12) throw new Error("Both passwords must be at least 12 characters.");
  if (userPassword === ownerPassword) throw new Error("Use different opening and owner passwords.");
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw new Error("This PDF could not be opened. It may already be encrypted, corrupt, or unsupported."); }
  if (!pdf.getPageCount() || pdf.getPageCount() > PDF_LIMITS.pages) throw new Error("The PDF must contain 1-500 pages.");
  pdf.encrypt({ userPassword, ownerPassword, algorithm: "AES-256" });
  const output = new Uint8Array(await pdf.save({ useObjectStreams: true }));
  try {
    if (output.byteLength > PDF_LIMITS.perFileBytes || !checkPdfHeader(output)) throw new Error("The protected PDF failed output validation.");
    let unprotectedLoadSucceeded = false;
    try { await PDFDocument.load(output); unprotectedLoadSucceeded = true; } catch { /* Correct: encrypted output requires a password. */ }
    if (unprotectedLoadSucceeded) throw new Error("The output did not require a password and was not protected.");
    const checked = await PDFDocument.load(output, { password: userPassword, updateMetadata: false });
    if (checked.getPageCount() !== pdf.getPageCount()) throw new Error(`The protected PDF failed password and page-count verification (${checked.getPageCount()} of ${pdf.getPageCount()} pages).`);
    return output;
  } catch (error) { output.fill(0); throw error; }
}

