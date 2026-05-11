import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function parseFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".txt":
    case ".md":
      return await fs.readFile(filePath, "utf-8");

    case ".docx":
      return await parseDocx(filePath);

    case ".pdf":
      return await parsePdf(filePath);

    case ".rtf":
      return await parseRtf(filePath);

    default:
      try {
        return await fs.readFile(filePath, "utf-8");
      } catch {
        throw new Error(`Unsupported file format: ${ext}`);
      }
  }
}

async function parseDocx(filePath: string): Promise<string> {
  const mammoth = await import("mammoth");
  const buffer = await fs.readFile(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function parsePdf(filePath: string): Promise<string> {
  const pdfParse = await import("pdf-parse");
  const buffer = await fs.readFile(filePath);
  const data = await (pdfParse as any).default(buffer as any);
  return data.text;
}

async function parseRtf(filePath: string): Promise<string> {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("textutil", [
      "-convert", "txt",
      "-stdout",
      filePath,
    ]);
    return stdout;
  }

  const buffer = await fs.readFile(filePath);
  return buffer.toString("utf-8").replace(/\{\\[^{}]*\}/g, "").replace(/[{}\\]/g, "");
}
