/**
 * 工作区文件文本预览准入策略。
 *
 * @author kongweiguang
 */

/** 已知不可由文本编辑器直接预览的文件类别。 */
type WorkspaceFilePreviewUnsupportedCategory =
  | "archive"
  | "audioVideo"
  | "binaryData"
  | "database"
  | "document"
  | "executable"
  | "font"
  | "image"
  | "office";

/**
 * 文件打开前的预览决策。
 * `probe` 表示扩展名没有足够证据拒绝，调用方仍须执行受限内容探测。
 */
export type WorkspaceFilePreviewDecision =
  | { kind: "probe" }
  | {
      category: WorkspaceFilePreviewUnsupportedCategory;
      kind: "unsupported";
      matchedExtension: string;
      message: string;
    };

type WorkspaceFilePreviewRule = {
  category: WorkspaceFilePreviewUnsupportedCategory;
  extensions: readonly string[];
  message: string;
};

// 分类表只收录格式明确的非文本类型；未知格式必须交给内容探测，避免白名单误伤脚本和自定义配置。
const UNSUPPORTED_PREVIEW_RULES: readonly WorkspaceFilePreviewRule[] = [
  {
    category: "document",
    extensions: [".pdf", ".epub", ".mobi", ".azw", ".azw3"],
    message:
      "PDF 或电子书文件不能在文本编辑器中预览，可下载后使用对应阅读应用查看。",
  },
  {
    category: "office",
    extensions: [
      ".doc",
      ".docx",
      ".docm",
      ".dot",
      ".dotx",
      ".dotm",
      ".xls",
      ".xlsx",
      ".xlsm",
      ".xlsb",
      ".xlt",
      ".xltx",
      ".xltm",
      ".ppt",
      ".pptx",
      ".pptm",
      ".pps",
      ".ppsx",
      ".ppsm",
      ".pot",
      ".potx",
      ".potm",
      ".vsd",
      ".vsdx",
      ".pub",
      ".one",
      ".onetoc2",
      ".odt",
      ".ods",
      ".odp",
      ".odg",
      ".odf",
      ".pages",
      ".numbers",
    ],
    message:
      "Office 或办公文档不能在文本编辑器中预览，可下载后使用对应办公应用打开。",
  },
  {
    category: "archive",
    extensions: [
      ".tar.gz",
      ".tar.bz2",
      ".tar.xz",
      ".tar.zst",
      ".tgz",
      ".tbz",
      ".tbz2",
      ".txz",
      ".tzst",
      ".zip",
      ".zipx",
      ".rar",
      ".7z",
      ".tar",
      ".gz",
      ".bz2",
      ".xz",
      ".zst",
      ".lz",
      ".lz4",
      ".lzh",
      ".cab",
      ".arj",
      ".cpio",
      ".iso",
      ".deb",
      ".rpm",
      ".jar",
      ".war",
      ".ear",
      ".apk",
      ".aab",
      ".ipa",
      ".whl",
    ],
    message: "压缩包或归档文件不能在文本编辑器中预览，可下载后解压查看。",
  },
  {
    category: "image",
    extensions: [
      ".png",
      ".jpg",
      ".jpeg",
      ".gif",
      ".bmp",
      ".webp",
      ".avif",
      ".heic",
      ".heif",
      ".tif",
      ".tiff",
      ".ico",
      ".psd",
      ".raw",
      ".cr2",
      ".cr3",
      ".nef",
      ".arw",
      ".dng",
    ],
    message: "图片文件不能在文本编辑器中预览，可下载后使用图片应用查看。",
  },
  {
    category: "audioVideo",
    extensions: [
      ".mp3",
      ".wav",
      ".flac",
      ".aac",
      ".m4a",
      ".wma",
      ".ogg",
      ".oga",
      ".opus",
      ".mid",
      ".midi",
      ".mp4",
      ".m4v",
      ".mov",
      ".avi",
      ".mkv",
      ".webm",
      ".wmv",
      ".flv",
      ".mpeg",
      ".mpg",
      ".m2ts",
      ".3gp",
    ],
    message: "音视频文件不能在文本编辑器中预览，可下载后使用媒体应用播放。",
  },
  {
    category: "font",
    extensions: [".ttf", ".otf", ".woff", ".woff2", ".eot", ".pfb"],
    message: "字体文件不能在文本编辑器中预览，可下载后使用字体工具查看。",
  },
  {
    category: "database",
    extensions: [
      ".db",
      ".db3",
      ".sqlite",
      ".sqlite3",
      ".duckdb",
      ".mdb",
      ".accdb",
      ".dbf",
      ".realm",
      ".rdb",
    ],
    message:
      "数据库文件不能在文本编辑器中预览，可下载后使用对应数据库工具打开。",
  },
  {
    category: "executable",
    extensions: [
      ".exe",
      ".dll",
      ".msi",
      ".msp",
      ".com",
      ".scr",
      ".sys",
      ".cpl",
      ".so",
      ".dylib",
      ".o",
      ".obj",
      ".a",
      ".lib",
      ".class",
      ".pyc",
      ".pyo",
      ".pyd",
      ".node",
      ".wasm",
      ".appimage",
      ".dmg",
      ".bin",
    ],
    message:
      "可执行文件或程序二进制不能在文本编辑器中预览；如需处理，请下载后在可信环境中检查。",
  },
  {
    category: "binaryData",
    extensions: [
      ".parquet",
      ".avro",
      ".orc",
      ".arrow",
      ".feather",
      ".npy",
      ".npz",
      ".h5",
      ".hdf5",
      ".mat",
      ".pkl",
      ".pickle",
      ".sav",
      ".dta",
      ".sas7bdat",
      ".rds",
      ".fst",
      ".pcap",
      ".pcapng",
      ".p12",
      ".pfx",
      ".jks",
      ".keystore",
      ".der",
    ],
    message:
      "该文件是二进制数据格式，不能在文本编辑器中预览，可下载后使用对应工具查看。",
  },
];

const UNSUPPORTED_FILE_SUFFIXES = UNSUPPORTED_PREVIEW_RULES.flatMap((rule) =>
  rule.extensions.map((extension) => ({ extension, rule })),
).sort((left, right) => right.extension.length - left.extension.length);

/**
 * 根据文件名做保守的打开前判断。
 * 仅拒绝明确的非文本后缀；未知类型、无扩展名和点文件继续进入受限内容探测。
 */
export function resolveWorkspaceFilePreviewPolicy(
  fileNameOrPath: string,
): WorkspaceFilePreviewDecision {
  const separatorIndex = Math.max(
    fileNameOrPath.lastIndexOf("/"),
    fileNameOrPath.lastIndexOf("\\"),
  );
  const fileName = fileNameOrPath.slice(separatorIndex + 1).toLowerCase();
  const match = UNSUPPORTED_FILE_SUFFIXES.find(({ extension }) =>
    fileName.endsWith(extension),
  );

  if (!match) {
    return { kind: "probe" };
  }

  return {
    category: match.rule.category,
    kind: "unsupported",
    matchedExtension: match.extension,
    message: match.rule.message,
  };
}
