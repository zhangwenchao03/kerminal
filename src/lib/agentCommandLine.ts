export interface ParsedAgentCommand {
  shell: string;
  args: string[];
}

export function parseAgentCommandLine(input: string): ParsedAgentCommand {
  const parts = splitCommandLine(input.trim());
  const shell = parts[0]?.trim() ?? "";
  if (!shell) {
    throw new Error("Enter a command to launch a custom agent.");
  }
  return {
    args: parts.slice(1),
    shell,
  };
}

function splitCommandLine(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "\"" | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      const next = input[index + 1];
      if (next && (next === "\"" || next === "'" || next === "\\" || /\s/.test(next))) {
        current += next;
        index += 1;
      } else {
        current += char;
      }
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    parts.push(current);
  }
  return parts;
}
