import "server-only";

export type ParsedDocument = {
  text: string;
  fileType: string;
  pageCount?: number;
};

export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<ParsedDocument> {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  // PDF
  if (mimeType === "application/pdf" || ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return { text: result.text, fileType: "pdf", pageCount: result.total };
    } finally {
      await parser.destroy();
    }
  }

  // Images — OCR
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "bmp"].includes(ext)) {
    const Tesseract = (await import("tesseract.js")).default;
    const {
      data: { text },
    } = await Tesseract.recognize(buffer, "eng");
    return { text, fileType: "image" };
  }

  // Word docs
  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === "docx"
  ) {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer });
    return { text: value, fileType: "docx" };
  }

  // CSV / plain text / markdown
  if (
    mimeType === "text/csv" ||
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    ["csv", "txt", "md"].includes(ext)
  ) {
    return {
      text: buffer.toString("utf-8"),
      fileType: ext === "csv" ? "csv" : "text",
    };
  }

  throw new Error(`Unsupported file type: ${mimeType || ext}`);
}
