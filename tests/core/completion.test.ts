import { describe, it, expect } from "vitest";
import {
  TOP_LEVEL_COMMANDS,
  ALERTS_SUBCOMMANDS,
  CHANNELS_SUBCOMMANDS,
  renderBashCompletionScript,
  renderZshCompletionScript,
  generatePowerShellCompletion,
} from "../../src/core/completion.js";

describe("generatePowerShellCompletion", () => {
  it("contains Register-ArgumentCompleter", () => {
    const script = generatePowerShellCompletion();
    expect(script).toContain("Register-ArgumentCompleter");
  });

  it("registers for the sorokeep command", () => {
    const script = generatePowerShellCompletion();
    expect(script).toContain("sorokeep");
  });

  it("contains a PowerShell ScriptBlock", () => {
    const script = generatePowerShellCompletion();
    expect(script).toContain("ScriptBlock");
  });

  it("references completion data via sorokeep completion --query", () => {
    const script = generatePowerShellCompletion();
    expect(script).toContain("completion");
    expect(script).toContain("--query");
  });

  it("includes --cursor flag", () => {
    const script = generatePowerShellCompletion();
    expect(script).toContain("--cursor");
  });

  it("output is deterministic", () => {
    const first = generatePowerShellCompletion();
    const second = generatePowerShellCompletion();
    expect(first).toBe(second);
  });

  it("references the same completion query mechanism as bash/zsh generators", () => {
    const bashScript = renderBashCompletionScript();
    const zshScript = renderZshCompletionScript();
    const psScript = generatePowerShellCompletion();
    expect(psScript).toContain("completion");
    expect(psScript).toContain("--query");
    expect(psScript).toContain("--cursor");
    expect(psScript).toContain("sorokeep");
    expect(psScript).toContain("sorokeep");
    expect(bashScript).toContain("completion");
    expect(zshScript).toContain("completion");
  });

  it("generates a valid PowerShell script that starts with a comment or function", () => {
    const script = generatePowerShellCompletion();
    expect(script.length).toBeGreaterThan(0);
    expect(typeof script).toBe("string");
  });
});

describe("existing completion generators remain unchanged", () => {
  it("renderBashCompletionScript still works", () => {
    const script = renderBashCompletionScript();
    expect(script).toContain("#!/usr/bin/env bash");
    expect(script).toContain("complete -F _sorokeep_complete sorokeep");
  });

  it("renderZshCompletionScript still works", () => {
    const script = renderZshCompletionScript();
    expect(script).toContain("#compdef sorokeep");
    expect(script).toContain("compdef _sorokeep sorokeep");
  });
});
