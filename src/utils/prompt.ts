import readline from "node:readline";

let _yesOverride = false;

/**
 * Set the global --yes override flag.
 * When true, confirmPrompt returns true immediately without user interaction.
 */
export function setYesOverride(value: boolean): void {
  _yesOverride = value;
}

/**
 * Get the current value of the --yes override flag.
 */
export function getYesOverride(): boolean {
  return _yesOverride;
}

/**
 * Prompt the user for confirmation.
 * Returns true immediately when --yes override is active.
 * Otherwise, prompts via readline and returns true for 'y'/'yes' answers.
 */
export async function confirmPrompt(question: string): Promise<boolean> {
  if (_yesOverride) {
    return true;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}
