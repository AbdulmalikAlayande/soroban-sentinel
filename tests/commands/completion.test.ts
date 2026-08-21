import { describe, it, expect, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { Command } from "commander";
import { getDatabaseForTesting } from "../../src/db/database.js";
import { insertContract } from "../../src/db/repositories.js";
import { registerCompletionCommand } from "../../src/commands/completion.js";
import {
  getCompletionSuggestions,
  renderBashCompletionScript,
  renderFishCompletionScript,
  renderZshCompletionScript,
  TOP_LEVEL_COMMANDS,
} from "../../src/core/completion.js";

describe("CLI completion", () => {
  let db: Database.Database;
  const contractID = "CBEOJUP5FU6KKOEZ7RMTSKZ7YLBS5D6LVATIGCESOGXSZEQ2UWQFKZW6";

  beforeEach(() => {
    db = getDatabaseForTesting();
  });

  it("suggests all top-level subcommands at the root", () => {
    const suggestions = getCompletionSuggestions(db, ["sorokeep", ""], 1);
    expect(suggestions).toEqual(expect.arrayContaining(TOP_LEVEL_COMMANDS));
  });

  it("suggests watched contract IDs after status", () => {
    insertContract(db, {
      id: contractID,
      name: "watchme",
      network: "testnet",
    });

    const suggestions = getCompletionSuggestions(db, ["sorokeep", "status", ""], 2);
    expect(suggestions).toEqual([contractID]);
  });

  it("suggests alerts subcommands after alerts", () => {
    const suggestions = getCompletionSuggestions(db, ["sorokeep", "alerts", ""], 2);
    expect(suggestions).toEqual(expect.arrayContaining(["add", "list", "remove", "test", "history"]));
  });

  it("renders the bash completion script and references the completion query helper", () => {
    const script = renderBashCompletionScript();
    expect(script).toContain("sorokeep completion --query");
    expect(script).toContain("complete -F _sorokeep_complete sorokeep");
  });

  it("renders the zsh completion script and references the completion query helper", () => {
    const script = renderZshCompletionScript();
    expect(script).toContain("sorokeep completion --query");
    expect(script).toContain("compdef _sorokeep sorokeep");
  });

  it("renders the fish completion script with fish-specific completion entries", () => {
    const script = renderFishCompletionScript();
    expect(script).toContain("complete -c sorokeep");
    expect(script).toContain("watch status check daemon alerts guard costs resources restore channels completion");
  });

  it("prints the fish completion script when --script fish is used", () => {
    const program = new Command();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let action: ((words: string[], options: { script?: string; query?: boolean; cursor?: number }) => void) | undefined;

    vi.spyOn(Command.prototype, "action").mockImplementation(function (this: Command, fn) {
      action = fn as typeof action;
      return this;
    });

    registerCompletionCommand(program);
    expect(action).toBeDefined();

    action?.([], { script: "fish" });

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("complete -c sorokeep"));
  });

  it("prints the PowerShell completion script when --script powershell is used", () => {
    const program = new Command();
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let action: ((words: string[], options: { script?: string; query?: boolean; cursor?: number }) => void) | undefined;

    vi.spyOn(Command.prototype, "action").mockImplementation(function (this: Command, fn) {
      action = fn as typeof action;
      return this;
    });

    registerCompletionCommand(program);
    expect(action).toBeDefined();

    action?.([], { script: "powershell" });

    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Register-ArgumentCompleter"));
  });
});
