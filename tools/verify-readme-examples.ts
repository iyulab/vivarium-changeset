// Extracts the fenced code examples from each SDK README and executes them
// against the real SDK, exactly as a fresh consumer would: the TypeScript
// examples run in a throwaway package that npm-installs the SDK, the C#
// examples compile in a throwaway console project that references it.
// Guards against examples that drift from the API or silently do nothing.
//
// Usage: node tools/verify-readme-examples.ts [typescript|dotnet|all]

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function extractFences(markdownPath: string, language: string): string[] {
  const source = readFileSync(markdownPath, "utf8");
  const fences: string[] = [];
  const pattern = new RegExp("^```" + language + "\\r?\\n([\\s\\S]*?)^```", "gm");
  for (let match; (match = pattern.exec(source)) !== null; ) fences.push(match[1]);
  if (fences.length === 0) throw new Error(`no \`\`\`${language} fences in ${markdownPath}`);
  return fences;
}

function run(command: string, args: string[], cwd: string): void {
  if (process.platform === "win32" && command === "npm") {
    // npm is a .cmd shim on Windows, and Node refuses to spawn .cmd without a
    // shell (CVE-2024-27980 guard). Shell use is confined to this local-dev
    // branch; every argument is a repo-internal constant, never user input.
    execSync([command, ...args.map((a) => JSON.stringify(a))].join(" "), { cwd, stdio: "pipe" });
  } else {
    execFileSync(command, args, { cwd, stdio: "pipe" });
  }
}

function verifyTypescript(): void {
  const sdkDir = join(repoRoot, "sdk", "typescript");
  const fences = extractFences(join(sdkDir, "README.md"), "ts");
  const consumer = mkdtempSync(join(tmpdir(), "vivarium-readme-ts-"));
  try {
    writeFileSync(join(consumer, "package.json"), JSON.stringify({
      name: "readme-consumer", private: true, type: "module",
    }));
    run("npm", ["install", "--no-audit", "--no-fund", sdkDir], consumer);
    writeFileSync(join(consumer, "consumer.ts"), fences.join("\n"));
    run("node", ["consumer.ts"], consumer);
    console.log(`PASS typescript — ${fences.length} fences executed as one consumer module`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

function verifyDotnet(): void {
  const sdkDir = join(repoRoot, "sdk", "dotnet");
  const fences = extractFences(join(sdkDir, "README.md"), "csharp");
  const consumer = mkdtempSync(join(tmpdir(), "vivarium-readme-cs-"));
  try {
    // C# requires using directives before top-level statements — hoist and dedupe.
    const usings = new Set<string>();
    const statements: string[] = [];
    for (const fence of fences) {
      for (const line of fence.split(/\r?\n/)) {
        if (/^using [A-Za-z][\w.]*;$/.test(line.trim())) usings.add(line.trim());
        else statements.push(line);
      }
    }
    writeFileSync(join(consumer, "consumer.csproj"), `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${join(sdkDir, "Vivarium.Changeset", "Vivarium.Changeset.csproj")}" />
  </ItemGroup>
</Project>
`);
    writeFileSync(join(consumer, "Program.cs"), [...usings, "", ...statements].join("\n"));
    run("dotnet", ["run", "--project", consumer], consumer);
    console.log(`PASS dotnet — ${fences.length} fences executed as one consumer program`);
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
}

const mode = process.argv[2] ?? "all";
try {
  if (mode === "typescript" || mode === "all") verifyTypescript();
  if (mode === "dotnet" || mode === "all") verifyDotnet();
} catch (error: any) {
  console.error(`FAIL — ${error.message}`);
  if (error.stdout) console.error(String(error.stdout));
  if (error.stderr) console.error(String(error.stderr));
  process.exit(1);
}
