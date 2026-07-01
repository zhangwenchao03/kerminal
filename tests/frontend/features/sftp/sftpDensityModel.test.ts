/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import { resolveSftpFileRowHeight } from "../../../../src/features/sftp/sftpDensityModel";
import { FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT } from "../../../../src/features/sftp/virtualFixedListModel";

describe("resolveSftpFileRowHeight", () => {
  it("keeps the default file list rhythm comfortable", () => {
    expect(resolveSftpFileRowHeight("comfortable")).toBe(
      FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT,
    );
  });

  it("uses a tighter row height for compact SFTP panes", () => {
    expect(resolveSftpFileRowHeight("compact")).toBe(36);
  });

  it("uses a more open row height for spacious SFTP panes", () => {
    expect(resolveSftpFileRowHeight("spacious")).toBe(48);
  });
});
