import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { confirmPrompt, setYesOverride, getYesOverride } from "../../src/utils/prompt";
import readline from "node:readline";

describe("confirmPrompt", () => {
  let mockRl: { question: any; close: any };

  beforeEach(() => {
    // Reset override before each test
    setYesOverride(false);

    mockRl = { question: vi.fn(), close: vi.fn() };
    vi.spyOn(readline, "createInterface").mockReturnValue(mockRl as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("when --yes override is active", () => {
    it("returns true immediately without invoking readline", async () => {
      setYesOverride(true);

      const result = await confirmPrompt("Delete everything?");

      expect(result).toBe(true);
      expect(readline.createInterface).not.toHaveBeenCalled();
    });

    it("returns true even when called multiple times", async () => {
      setYesOverride(true);

      const r1 = await confirmPrompt("Question 1?");
      const r2 = await confirmPrompt("Question 2?");
      const r3 = await confirmPrompt("Question 3?");

      expect(r1).toBe(true);
      expect(r2).toBe(true);
      expect(r3).toBe(true);
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });

  describe("when --yes override is NOT active", () => {
    it("prompts the user via readline with the given question", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("yes");
        },
      );

      const result = await confirmPrompt("Delete everything? (y/N): ");

      expect(readline.createInterface).toHaveBeenCalledTimes(1);
      expect(mockRl.question).toHaveBeenCalledWith(
        "Delete everything? (y/N): ",
        expect.any(Function),
      );
      expect(result).toBe(true);
    });

    it("returns false when user answers 'no'", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("no");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(false);
    });

    it("returns false when user answers 'n'", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("n");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(false);
    });

    it("returns true for case-insensitive 'Y' answer", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("Y");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(true);
    });

    it("returns true for case-insensitive 'YES' answer", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("YES");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(true);
    });

    it("returns false for any non-affirmative answer", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("maybe");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(false);
    });

    it("returns false for empty answer", async () => {
      mockRl.question.mockImplementation(
        (_query: string, cb: (answer: string) => void) => {
          cb("");
        },
      );

      const result = await confirmPrompt("Proceed? (y/N): ");

      expect(result).toBe(false);
    });
  });
});

describe("setYesOverride / getYesOverride", () => {
  afterEach(() => {
    setYesOverride(false);
  });

  it("getYesOverride returns false by default", () => {
    expect(getYesOverride()).toBe(false);
  });

  it("getYesOverride returns true after setYesOverride(true)", () => {
    setYesOverride(true);
    expect(getYesOverride()).toBe(true);
  });

  it("getYesOverride returns false after setYesOverride(false)", () => {
    setYesOverride(true);
    setYesOverride(false);
    expect(getYesOverride()).toBe(false);
  });
});
