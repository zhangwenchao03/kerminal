import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const isTauriMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  isTauri: () => isTauriMock(),
}));

type SftpPreviewScenario = {
  arguments: Record<string, unknown>;
  expectedArgumentsSummary: string;
  expectedAudit: Record<string, unknown>;
  expectedPending: Record<string, unknown>;
  name: string;
  reason: string;
  toolId: string;
};

const sftpPreviewScenarios: SftpPreviewScenario[] = [
  {
    arguments: {
      hostId: "dev-server",
      path: "/var/log",
    },
    expectedArgumentsSummary: "hostId=dev-server, path=/var/log",
    expectedAudit: {
      resultSummary: "远程目录已读取，浏览器预览已模拟返回目录条目摘要。",
      status: "succeeded",
      toolId: "sftp.list",
    },
    expectedPending: {
      confirmation: "always",
      risk: "remote",
      toolTitle: "列出远程目录",
    },
    name: "previews SFTP list as a remote confirmed read",
    reason: "预览读取远程目录",
    toolId: "sftp.list",
  },
  {
    arguments: {
      fromPath: "/tmp/kerminal-ai-preview.tmp",
      hostId: "dev-server",
      toPath: "/tmp/kerminal-ai-preview.renamed.tmp",
    },
    expectedArgumentsSummary:
      "fromPath=/tmp/kerminal-ai-preview.tmp, hostId=dev-server, toPath=/tmp/kerminal-ai-preview.renamed.tmp",
    expectedAudit: {
      resultSummary: "远程路径已重命名，浏览器预览已模拟完成 SFTP 写操作。",
      risk: "remote",
      status: "succeeded",
      toolId: "sftp.rename",
    },
    expectedPending: {
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      toolTitle: "重命名远程路径",
    },
    name: "previews SFTP rename as a remote confirmed write",
    reason: "预览重命名远程路径",
    toolId: "sftp.rename",
  },
  {
    arguments: {
      fromPath: "/tmp/kerminal-ai-preview.renamed.tmp",
      hostId: "dev-server",
      toPath: "/tmp/kerminal-ai-preview/moved.tmp",
    },
    expectedArgumentsSummary:
      "fromPath=/tmp/kerminal-ai-preview.renamed.tmp, hostId=dev-server, toPath=/tmp/kerminal-ai-preview/moved.tmp",
    expectedAudit: {
      resultSummary: "远程路径已移动，浏览器预览已模拟完成 SFTP 写操作。",
      risk: "remote",
      status: "succeeded",
      toolId: "sftp.move",
    },
    expectedPending: {
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      toolTitle: "移动远程路径",
    },
    name: "previews SFTP move as a remote confirmed write",
    reason: "预览移动远程路径",
    toolId: "sftp.move",
  },
  {
    arguments: {
      hostId: "dev-server",
      maxBytes: 4096,
      path: "/var/log/app.log",
    },
    expectedArgumentsSummary:
      "hostId=dev-server, maxBytes=4096, path=/var/log/app.log",
    expectedAudit: {
      resultSummary: "远程文件已预览，浏览器预览已模拟返回文本片段。",
      risk: "remote",
      status: "succeeded",
      toolId: "sftp.preview",
    },
    expectedPending: {
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      toolTitle: "预览远程文件",
    },
    name: "previews SFTP file preview as a remote confirmed read",
    reason: "预览远程文件片段",
    toolId: "sftp.preview",
  },
  {
    arguments: {
      hostId: "dev-server",
      localPath: "~/.kerminal/temp/kerminal-ai-preview-app.log",
      remotePath: "/var/log/app.log",
    },
    expectedArgumentsSummary:
      "hostId=dev-server, localPath=~/.kerminal/temp/kerminal-ai-preview-app.log, remotePath=/var/log/app.log",
    expectedAudit: {
      resultSummary: "远程文件已下载，浏览器预览已模拟完成 SFTP 下载操作。",
      risk: "remote",
      status: "succeeded",
      toolId: "sftp.download",
    },
    expectedPending: {
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      toolTitle: "下载远程文件",
    },
    name: "previews SFTP download as a remote confirmed transfer",
    reason: "预览下载远程文件",
    toolId: "sftp.download",
  },
  {
    arguments: {
      hostId: "dev-server",
      localPath: "~/.kerminal/temp/kerminal-ai-preview-upload.txt",
      remotePath: "/tmp/kerminal-ai-preview-upload.txt",
    },
    expectedArgumentsSummary:
      "hostId=dev-server, localPath=~/.kerminal/temp/kerminal-ai-preview-upload.txt, remotePath=/tmp/kerminal-ai-preview-upload.txt",
    expectedAudit: {
      resultSummary: "本地文件已上传，浏览器预览已模拟完成 SFTP 上传操作。",
      risk: "remote",
      status: "succeeded",
      toolId: "sftp.upload",
    },
    expectedPending: {
      audit: "summary",
      confirmation: "always",
      risk: "remote",
      toolTitle: "上传本地文件",
    },
    name: "previews SFTP upload as a remote confirmed transfer",
    reason: "预览上传本地文件",
    toolId: "sftp.upload",
  },
  {
    arguments: {
      directory: false,
      hostId: "dev-server",
      path: "/tmp/kerminal-ai-preview.tmp",
    },
    expectedArgumentsSummary:
      "directory=false, hostId=dev-server, path=/tmp/kerminal-ai-preview.tmp",
    expectedAudit: {
      resultSummary: "远程文件删除已执行，浏览器预览已模拟完成破坏性 SFTP 操作。",
      risk: "destructive",
      status: "succeeded",
      toolId: "sftp.delete",
    },
    expectedPending: {
      audit: "full",
      confirmation: "always",
      risk: "destructive",
      toolTitle: "删除远程文件",
    },
    name: "previews SFTP delete as a destructive full-audit action",
    reason: "预览删除远程文件",
    toolId: "sftp.delete",
  },
];

describe("aiToolInvocationApi SFTP browser preview", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
  });

  for (const scenario of sftpPreviewScenarios) {
    it(scenario.name, async () => {
      const {
        confirmAiToolInvocation,
        prepareAiToolInvocation,
      } = await import("./aiToolInvocationApi");

      const pending = await prepareAiToolInvocation({
        arguments: scenario.arguments,
        reason: scenario.reason,
        toolId: scenario.toolId,
      });
      const audit = await confirmAiToolInvocation({
        approved: true,
        invocationId: pending.id,
      });

      expect(pending).toMatchObject(scenario.expectedPending);
      expect(pending.clientAction).toBeNull();
      expect(pending.argumentsSummary).toBe(scenario.expectedArgumentsSummary);
      expect(audit).toMatchObject(scenario.expectedAudit);
      expect(invokeMock).not.toHaveBeenCalled();
    });
  }
});
