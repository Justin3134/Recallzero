import { readFileSync } from "fs";
import { resolve } from "path";
import { PDFParse } from "pdf-parse";

async function main() {
  const buf = readFileSync(resolve(__dirname, "../demo-assets/sample-loan-agreement.pdf"));
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  await parser.destroy();
  console.log("pages:", result.total);
  console.log("text sample:", result.text.slice(0, 200).replace(/\n+/g, " "));
  if (!result.text.includes("SPLITPAY")) throw new Error("PDF text extraction failed");
  console.log("PDF PARSE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
