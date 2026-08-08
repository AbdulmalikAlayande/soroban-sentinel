import { describe, it, expect } from "vitest";
import { renderDiffValue } from "../../src/commands/inspect";

describe("inspect diff renderer", () => {
  it("renders updated diffs with old and new values using contrasting formatting", () => {
    const rendered = renderDiffValue({
      diffType: "updated",
      oldValue: "old-value",
      newValue: "new-value",
      useColors: true,
    });

    expect(rendered).toContain("old-value");
    expect(rendered).toContain("new-value");
    expect(rendered).toContain("- ");
    expect(rendered).toContain("+ ");
  });

  it("renders created diffs without a missing old side", () => {
    const rendered = renderDiffValue({
      diffType: "created",
      newValue: "created-value",
      useColors: true,
    });

    expect(rendered).toContain("created-value");
    expect(rendered).not.toContain("undefined");
    expect(rendered).toContain("+ ");
  });

  it("renders deleted diffs without a missing new side", () => {
    const rendered = renderDiffValue({
      diffType: "deleted",
      oldValue: "removed-value",
      useColors: true,
    });

    expect(rendered).toContain("removed-value");
    expect(rendered).not.toContain("undefined");
    expect(rendered).toContain("- ");
  });

  it("returns plain text when colors are disabled", () => {
    const rendered = renderDiffValue({
      diffType: "updated",
      oldValue: "one",
      newValue: "two",
      useColors: false,
    });

    expect(rendered).toBe("- one\n+ two");
  });
});
