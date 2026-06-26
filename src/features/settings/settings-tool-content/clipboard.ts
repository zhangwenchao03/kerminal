import { writeDesktopClipboardText } from "../../../lib/desktopClipboardApi";

export async function writeTextToClipboard(text: string) {
  const result = await writeDesktopClipboardText(text);
  if (!result.ok) {
    throw new Error(`Clipboard write failed: ${result.reason}`);
  }
}
