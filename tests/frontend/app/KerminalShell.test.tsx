import { beforeEach, describe } from "vitest";
import "../support/app/KerminalShell.testSupport.tsx";

const { resetKerminalShellTestState } = await import(
  "./kerminal-shell/setup"
);

const { registerSessionAndToolTests } = await import(
  "./kerminal-shell/session-and-tools"
);
const { registerChromeAndRestoreTests } = await import(
  "./kerminal-shell/chrome-and-restore"
);
const { registerRemoteHostTests } = await import(
  "./kerminal-shell/remote-hosts"
);

describe("KerminalShell", () => {
  beforeEach(resetKerminalShellTestState);

  registerSessionAndToolTests();
  registerChromeAndRestoreTests();
  registerRemoteHostTests();
});
