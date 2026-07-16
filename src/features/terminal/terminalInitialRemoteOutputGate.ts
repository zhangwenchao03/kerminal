const INITIAL_REMOTE_OUTPUT_FAST_BATCH_LIMIT = 8;
const INITIAL_REMOTE_OUTPUT_FAST_BYTE_LIMIT = 128 * 1024;
const INITIAL_REMOTE_OUTPUT_FAST_WINDOW_MS = 2_000;
const UTF8_ENCODER = new TextEncoder();

export interface InitialRemoteOutputGate {
  shouldWriteNow(data: string, now?: number): boolean;
}

/**
 * 远端会话启动阶段的低延迟输出预算。
 *
 * 预算耗尽或窗口结束后永久回到批量 writer；字符数按 UTF-8 字节计算。
 */
export function createInitialRemoteOutputGate(
  startedAtMs: number,
): InitialRemoteOutputGate {
  let fastBatches = 0;
  let fastBytes = 0;

  return {
    shouldWriteNow(data, now = Date.now()) {
      if (
        now - startedAtMs > INITIAL_REMOTE_OUTPUT_FAST_WINDOW_MS ||
        fastBatches >= INITIAL_REMOTE_OUTPUT_FAST_BATCH_LIMIT
      ) {
        return false;
      }
      const bytes = UTF8_ENCODER.encode(data).byteLength;
      if (fastBytes + bytes > INITIAL_REMOTE_OUTPUT_FAST_BYTE_LIMIT) {
        return false;
      }
      fastBatches += 1;
      fastBytes += bytes;
      return true;
    },
  };
}
