const snippetVariablePattern = /\{\{\s*([^{}\r\n]+?)\s*\}\}/g;

export function extractSnippetVariables(command: string): string[] {
  const variables: string[] = [];
  const seen = new Set<string>();

  for (const match of command.matchAll(snippetVariablePattern)) {
    const name = match[1]?.trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    variables.push(name);
  }

  return variables;
}

export function renderSnippetCommand(
  command: string,
  values: Record<string, string>,
): string {
  return command.replace(snippetVariablePattern, (_placeholder, rawName: string) => {
    const name = rawName.trim();
    return values[name] ?? "";
  });
}
