/**
 * @author kongweiguang
 */

import { describe, expect, it } from "vitest";
import {
  SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME,
  buildSftpLocalFileDragPayload,
  hasSftpLocalFileDragPayloadType,
  parseSftpLocalFileDragPayload,
  resolveSftpLocalPaneDropTarget,
  resolveSftpLocalUploadDropEvent,
} from "./sftpLocalUploadDropModel";

describe("sftpLocalUploadDropModel", () => {
  it("uploads dropped local paths only when the pointer is inside the drop zone", () => {
    const dropZone = createDropZone();

    expect(
      resolveSftpLocalUploadDropEvent(
        {
          payload: {
            paths: ["C:/tmp/release.tgz", "C:/tmp/dist"],
            position: { x: 24, y: 48 },
            type: "drop",
          },
        },
        dropZone,
      ),
    ).toEqual({
      kind: "upload",
      paths: ["C:/tmp/release.tgz", "C:/tmp/dist"],
    });
    expect(
      resolveSftpLocalUploadDropEvent(
        {
          payload: {
            paths: ["C:/tmp/release.tgz"],
            position: { x: 500, y: 500 },
            type: "drop",
          },
        },
        dropZone,
      ),
    ).toEqual({ kind: "ignore" });
  });

  it("tracks hover only while the pointer is inside the drop zone", () => {
    const dropZone = createDropZone();

    expect(
      resolveSftpLocalUploadDropEvent(
        { payload: { position: { x: 24, y: 48 }, type: "enter" } },
        dropZone,
      ),
    ).toEqual({ active: true, kind: "hover" });
    expect(
      resolveSftpLocalUploadDropEvent(
        { payload: { position: { x: 500, y: 500 }, type: "over" } },
        dropZone,
      ),
    ).toEqual({ active: false, kind: "hover" });
    expect(
      resolveSftpLocalUploadDropEvent({ payload: { type: "leave" } }, dropZone),
    ).toEqual({ kind: "clear" });
  });

  it("treats malformed payloads as a clear action and supports nested payloads", () => {
    const dropZone = createDropZone();

    expect(resolveSftpLocalUploadDropEvent({ payload: "bad" }, dropZone)).toEqual(
      { kind: "clear" },
    );
    expect(
      resolveSftpLocalUploadDropEvent(
        {
          payload: {
            payload: {
              paths: ["C:/tmp/release.tgz"],
              position: { x: 24, y: 48 },
              type: "drop",
            },
          },
        },
        dropZone,
      ),
    ).toEqual({ kind: "upload", paths: ["C:/tmp/release.tgz"] });
  });

  it("builds and parses workbench local file drag payloads", () => {
    const payload = buildSftpLocalFileDragPayload({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
        { kind: "directory", name: "dist", path: "C:/tmp/dist" },
        { kind: "other" as "file", name: "", path: "" },
      ],
    });

    expect(
      hasSftpLocalFileDragPayloadType([SFTP_LOCAL_FILE_DRAG_PAYLOAD_MIME]),
    ).toBe(true);
    expect(parseSftpLocalFileDragPayload(JSON.stringify(payload))).toEqual({
      entries: [
        { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
        { kind: "directory", name: "dist", path: "C:/tmp/dist" },
      ],
      source: "local",
    });
  });

  it("rejects invalid workbench local file drag payloads", () => {
    expect(parseSftpLocalFileDragPayload("{bad json")).toBeNull();
    expect(
      parseSftpLocalFileDragPayload(
        JSON.stringify({
          entries: [
            { kind: "symlink", name: "latest", path: "C:/tmp/latest" },
          ],
          source: "local",
        }),
      ),
    ).toBeNull();
    expect(
      parseSftpLocalFileDragPayload(
        JSON.stringify({
          entries: [
            { kind: "file", name: "release.tgz", path: "C:/tmp/release.tgz" },
          ],
          source: "remote",
        }),
      ),
    ).toBeNull();
  });

  it("resolves local pane drop decisions for download and local copy", () => {
    expect(
      resolveSftpLocalPaneDropTarget({
        hasLocalPayload: false,
        hasRemotePayload: true,
        type: "over",
      }),
    ).toEqual({ active: true, kind: "download-hover" });
    expect(
      resolveSftpLocalPaneDropTarget({
        hasLocalPayload: true,
        hasRemotePayload: false,
        type: "over",
      }),
    ).toEqual({
      active: true,
      kind: "copy-hover",
    });
    expect(
      resolveSftpLocalPaneDropTarget({
        hasLocalPayload: true,
        hasRemotePayload: false,
        type: "drop",
      }),
    ).toEqual({ kind: "copy" });
  });
});

function createDropZone() {
  const element = document.createElement("div");
  element.getBoundingClientRect = () =>
    ({
      bottom: 240,
      height: 220,
      left: 10,
      right: 430,
      top: 20,
      width: 420,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}
