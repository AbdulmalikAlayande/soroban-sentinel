# First PR Tutorial

This tutorial walks through a real, complete example of fixing a "complexity:trivial" issue in Sorokeep. We will fix a bug where `formatBytes` (which formats file sizes in bytes) does not handle negative values properly.

## Step 1: Identify the Issue

While reading `src/utils/formatting.ts`, we noticed `formatBytes(bytes)` takes a number and formats it as KB, MB, etc. However, if passed a negative number, `Math.log(bytes)` becomes `NaN` and it returns `NaN undefined`. We want to fix it so that `formatBytes(-1024)` returns `"-1 KB"`.

## Step 2: Write the Failing Test

Following the strict Test-Driven Development (TDD) rule in Sorokeep, we must write our test *before* implementing the logic. 

We read `tests/utils/formatting.test.ts` and realized `formatBytes` didn't have any tests yet. So we added a new describe block for it:

```typescript
describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });
  it("formats positive bytes", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
  });
  it("formats negative bytes", () => {
    expect(formatBytes(-1024)).toBe("-1 KB");
    expect(formatBytes(-1536)).toBe("-1.5 KB");
  });
});
```

We ran the test locally to confirm it fails on the negative cases:
```bash
npx vitest run tests/utils/formatting.test.ts
```

## Step 3: Implement the Fix

Now that we have a failing test, we implement the fix in `src/utils/formatting.ts`. We update the function to check if the value is negative and compute the logarithm on the absolute value:

```typescript
export function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const isNegative = bytes < 0;
    const absBytes = Math.abs(bytes);
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(absBytes) / Math.log(k));
    const result = parseFloat((absBytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    return isNegative ? "-" + result : result;
}
```

We run the test again and see it passes!
```bash
npx vitest run tests/utils/formatting.test.ts
```

## Step 4: Linting and Type Checking

Before committing, we make sure the project standards are met:

```bash
npm run lint
npx tsc --noEmit
```

Both pass cleanly.

## Step 5: Commit and PR

We followed the conventional commit format defined in `CONTRIBUTING.md`:

```bash
git checkout -b fix/format-bytes-negative
git add src/utils/formatting.ts tests/utils/formatting.test.ts docs/first-pr-tutorial.md CONTRIBUTING.md
git commit -m "fix: handle negative byte values in formatBytes"
git push -u origin fix/format-bytes-negative
```

Then we opened a Pull Request, linking this tutorial to help future contributors!
