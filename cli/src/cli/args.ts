const COMMAND_ARGS: Record<string, { flags: string[]; positionals: number }> = {
  init: { flags: [], positionals: 0 },
  profile: { flags: [], positionals: 0 },
  update: { flags: ['--daily', '--weekly'], positionals: 0 },
  status: { flags: ['--check'], positionals: 0 },
  mirror: { flags: ['--share'], positionals: 0 },
  stop: { flags: [], positionals: 0 },
  mcp: { flags: [], positionals: 0 },
  __worker: { flags: [], positionals: 0 },
};

/** Only an explicit y/yes opens the paid-build gate. */
export function isYes(answer: string): boolean {
  const a = answer.trim().toLowerCase();
  return a === 'y' || a === 'yes';
}

/** Tiny edit distance for command and flag suggestions. */
export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/** The validation error for a command's arguments, or undefined when valid. */
export function argProblem(cmd: string, rest: string[]): string | undefined {
  const spec = COMMAND_ARGS[cmd];
  if (!spec) return undefined;
  let positionals = 0;
  for (const arg of rest) {
    if (arg.startsWith('-')) {
      if (!spec.flags.includes(arg)) {
        const guess = spec.flags.find((flag) => editDistance(arg, flag) <= 2);
        return `unknown flag for ${cmd}: ${arg}${guess ? `  (did you mean ${guess}?)` : ''}`;
      }
    } else if (++positionals > spec.positionals) {
      return `unexpected argument for ${cmd}: ${arg}`;
    }
  }
  return undefined;
}

export function validatesArgs(cmd: string): boolean {
  return cmd in COMMAND_ARGS;
}
