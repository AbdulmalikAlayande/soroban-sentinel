import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createProgram } from "../src/cli/program.js";

function getRendererCommand() {
  const candidates = ["man", "nroff", "groff", "mandoc"];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next renderer.
    }
  }

  return null;
}

export function buildManPage() {
  const program = createProgram();
  const description = program.description();
  const commandEntries = program.commands
    .filter((command) => command.name() && command.name() !== "help")
    .map((command) => [command.name(), command.description() ?? ""] as const);

  const sections = commandEntries.flatMap(([commandName, commandDescription]) => [
    `.SH ${commandName.toUpperCase()}`,
    commandDescription,
  ]);

  const manPage = [
    `.TH SOROKEEP 1 "${new Date().toISOString().slice(0, 10)}" "sorokeep" "User Commands"`,
    `.SH NAME`,
    `sorokeep \- ${description}`,
    `.SH SYNOPSIS`,
    `.B sorokeep`,
    `.SH DESCRIPTION`,
    description,
    `.SH COMMANDS`,
    ...sections,
    `.SH SEE ALSO`,
    `sorokeep(1)`,
  ].join("\n");

  return manPage;
}

export function renderManPage(filePath: string) {
  const renderer = getRendererCommand();

  if (!renderer) {
    const content = readFileSync(filePath, "utf8");
    return (
      content.includes(".TH SOROKEEP") &&
      content.includes(".SH NAME") &&
      content.includes(".SH COMMANDS") &&
      content.includes(".SH SEE ALSO")
    );
  }

  try {
    const args = renderer === "man" ? ["-l", filePath] : ["-man", filePath];
    execFileSync(renderer, args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function writeManPage(outputPath = path.resolve("man", "sorokeep.1")) {
  const content = buildManPage();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content, "utf8");
  return outputPath;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputPath = writeManPage();
  console.log(`Wrote ${outputPath}`);
}
