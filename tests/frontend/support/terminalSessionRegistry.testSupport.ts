import {
  listTerminalPaneSessionRecords,
  unregisterTerminalPaneSession,
} from "../../../src/features/terminal/terminalSessionRegistry";
import { clearRemoteSocksAutoInjection } from "../../../src/features/terminal/terminalProxyAutoInjection";

/** 通过公开注销生命周期清理测试创建的 pane 与关联代理注入。 */
export function unregisterTestTerminalPaneSessions() {
  for (const session of listTerminalPaneSessionRecords()) {
    if (session.remoteHostId) {
      clearRemoteSocksAutoInjection(session.remoteHostId);
    }
    unregisterTerminalPaneSession(session.paneId, session.sessionId);
  }
}
