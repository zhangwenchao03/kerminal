/**
 * Density mapping for SFTP workbench chrome and fixed-row file lists.
 *
 * @author kongweiguang
 */

import type { InterfaceDensity } from "../settings/settingsModel";
import { FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT } from "./virtualFixedListModel";

const SFTP_COMPACT_ROW_HEIGHT = 36;
const SFTP_SPACIOUS_ROW_HEIGHT = 48;

export function resolveSftpFileRowHeight(
  interfaceDensity: InterfaceDensity = "comfortable",
) {
  if (interfaceDensity === "compact") {
    return SFTP_COMPACT_ROW_HEIGHT;
  }
  if (interfaceDensity === "spacious") {
    return SFTP_SPACIOUS_ROW_HEIGHT;
  }
  return FIXED_ROW_VIRTUAL_LIST_ROW_HEIGHT;
}
