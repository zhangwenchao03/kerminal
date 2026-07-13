/**
 * 工作区文件预览策略测试。
 *
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import { resolveWorkspaceFilePreviewPolicy } from "../../../../src/features/sftp/workspaceFilePreviewPolicy";

describe("resolveWorkspaceFilePreviewPolicy", () => {
  it.each([
    ["/srv/contracts/AGREEMENT.PDF", "document", ".pdf"],
    ["/srv/contracts/template.DOCX", "office", ".docx"],
    ["/srv/backups/release.TAR.GZ", "archive", ".tar.gz"],
    ["/srv/assets/banner.PNG", "image", ".png"],
    ["/srv/media/demo.MP4", "audioVideo", ".mp4"],
    ["/srv/fonts/ui.WOFF2", "font", ".woff2"],
    ["/srv/data/app.SQLITE3", "database", ".sqlite3"],
    ["/srv/bin/worker.EXE", "executable", ".exe"],
    ["/srv/data/events.PARQUET", "binaryData", ".parquet"],
  ] as const)(
    "rejects known non-text file %s before content probing",
    (path, category, matchedExtension) => {
      expect(resolveWorkspaceFilePreviewPolicy(path)).toMatchObject({
        category,
        kind: "unsupported",
        matchedExtension,
      });
    },
  );

  it("prefers the longest compound extension and only matches filename suffixes", () => {
    expect(
      resolveWorkspaceFilePreviewPolicy("/srv/backup.tar.gz"),
    ).toMatchObject({
      category: "archive",
      kind: "unsupported",
      matchedExtension: ".tar.gz",
    });
    expect(resolveWorkspaceFilePreviewPolicy("/srv/report.pdf.txt")).toEqual({
      kind: "probe",
    });
    expect(
      resolveWorkspaceFilePreviewPolicy("/srv/archive.tar.gz.asc"),
    ).toEqual({
      kind: "probe",
    });
    expect(resolveWorkspaceFilePreviewPolicy("/srv/pdf/report.txt")).toEqual({
      kind: "probe",
    });
  });

  it.each([
    "/srv/README",
    "/srv/.env",
    "/srv/config.custom-format",
    "/srv/app.ts",
    "/srv/server.key",
    "/srv/icon.svg",
    "/srv/报告.未知",
    "",
  ])(
    "keeps unknown or extensionless file %s eligible for bounded probing",
    (path) => {
      expect(resolveWorkspaceFilePreviewPolicy(path)).toEqual({
        kind: "probe",
      });
    },
  );

  it("returns guidance suited to the blocked file category", () => {
    expect(resolveWorkspaceFilePreviewPolicy("C:\\Temp\\manual.pdf")).toEqual({
      category: "document",
      kind: "unsupported",
      matchedExtension: ".pdf",
      message:
        "PDF 或电子书文件不能在文本编辑器中预览，可下载后使用对应阅读应用查看。",
    });
    expect(resolveWorkspaceFilePreviewPolicy("/srv/release.zip")).toMatchObject(
      {
        message: "压缩包或归档文件不能在文本编辑器中预览，可下载后解压查看。",
      },
    );
  });
});
