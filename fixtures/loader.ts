/**
 * Fixture loader shared by the tests and the CLI.
 * A fixture file is { description, input: EngineInput, context?: { profile?, history? } }.
 * Factur-X / PDF inputs may reference a file next to the fixture with
 * "document_base64_file" instead of an inline "document_base64".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { EngineContext, EngineInput } from "../engine/types";

export interface FixtureFile {
  description: string;
  input: EngineInput;
  context?: Pick<EngineContext, "profile" | "history" | "materiality_threshold">;
}

export function loadFixture(file: string): FixtureFile {
  const abs = path.resolve(file);
  const raw = JSON.parse(readFileSync(abs, "utf8")) as { description: string; input: Record<string, unknown>; context?: FixtureFile["context"] };
  const input = { ...raw.input };
  if (typeof input.document_base64_file === "string") {
    input.document_base64 = readFileSync(path.resolve(path.dirname(abs), input.document_base64_file)).toString("base64");
    delete input.document_base64_file;
  }
  return { description: raw.description, input: input as unknown as EngineInput, ...(raw.context ? { context: raw.context } : {}) };
}

/** Builds an EngineInput directly from a .pdf / .xml / .json path (CLI convenience). */
export function inputFromPath(file: string): FixtureFile {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return { description: path.basename(file), input: { format: "pdf", document_base64: readFileSync(file).toString("base64"), mime_type: "application/pdf" } };
  if (ext === ".xml") return { description: path.basename(file), input: { format: "ubl", xml: readFileSync(file, "utf8") } };
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
    const mime = ext === ".jpg" ? "image/jpeg" : `image/${ext.slice(1)}`;
    return { description: path.basename(file), input: { format: "image", document_base64: readFileSync(file).toString("base64"), mime_type: mime } };
  }
  return loadFixture(file);
}
