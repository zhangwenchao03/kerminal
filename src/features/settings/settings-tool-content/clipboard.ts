export async function writeTextToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}
