/**
 * SFTP 文件显示与路径展示工具。
 *
 * @author kongweiguang
 */

/**
 * 从本地或远程路径中提取文件名。
 */
export function fileNameFromPath(path: string, fallback = "download") {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1) || fallback;
}

/**
 * 将字节数格式化为 SFTP UI 使用的紧凑文本。
 */
export function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
