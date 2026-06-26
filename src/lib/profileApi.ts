import { invoke, isTauri } from "@tauri-apps/api/core";

export interface TerminalProfile {
  id: string;
  name: string;
  shell: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  isDefault: boolean;
  sidebarGroupId?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileCreateRequest {
  name: string;
  shell: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  setDefault?: boolean;
  sidebarGroupId?: string;
}

export interface ProfileUpdateRequest extends ProfileCreateRequest {
  id: string;
  sortOrder: number;
}

interface NormalizedProfileRequest {
  name: string;
  shell: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
  setDefault: boolean;
  sidebarGroupId?: string;
}

interface NormalizedProfileUpdateRequest extends NormalizedProfileRequest {
  id: string;
  sortOrder: number;
}

export type ShellCandidateSource =
  | "environment"
  | "path"
  | "commonPath"
  | "fallback";

export interface ShellCandidate {
  id: string;
  name: string;
  shell: string;
  args: string[];
  source: ShellCandidateSource;
  isAvailable: boolean;
  isDefault: boolean;
}

export const browserPreviewProfiles: TerminalProfile[] = [
  {
    args: [],
    createdAt: "browser-preview",
    env: {},
    id: "profile-browser-preview",
    isDefault: true,
    name: "浏览器预览终端",
    shell: "browser-preview",
    sortOrder: 10,
    updatedAt: "browser-preview",
  },
];

let browserPreviewProfileCount = browserPreviewProfiles.length;

export async function listProfiles(): Promise<TerminalProfile[]> {
  if (!isTauri()) {
    return browserPreviewProfiles;
  }

  return invoke<TerminalProfile[]>("profile_list");
}

export async function detectShells(): Promise<ShellCandidate[]> {
  if (!isTauri()) {
    return [
      {
        args: [],
        id: "browser-preview",
        isAvailable: true,
        isDefault: true,
        name: "浏览器预览终端",
        shell: "browser-preview",
        source: "fallback",
      },
    ];
  }

  return invoke<ShellCandidate[]>("profile_detect_shells");
}

export async function createProfile(
  request: ProfileCreateRequest,
): Promise<TerminalProfile> {
  if (!isTauri()) {
    browserPreviewProfileCount += 1;
    const normalized = normalizeCreateRequest(request);
    return {
      args: normalized.args,
      createdAt: "browser-preview",
      cwd: normalized.cwd,
      env: normalized.env,
      id: `profile-browser-preview-${browserPreviewProfileCount}`,
      isDefault: normalized.setDefault,
      name: normalized.name,
      ...(normalized.sidebarGroupId
        ? { sidebarGroupId: normalized.sidebarGroupId }
        : {}),
      shell: normalized.shell,
      sortOrder: browserPreviewProfileCount * 10,
      updatedAt: "browser-preview",
    };
  }

  return invoke<TerminalProfile>("profile_create", {
    request: normalizeCreateRequest(request),
  });
}

export async function updateProfile(
  request: ProfileUpdateRequest,
): Promise<TerminalProfile> {
  if (!isTauri()) {
    const normalized = normalizeUpdateRequest(request);
    return {
      args: normalized.args,
      createdAt: "browser-preview",
      cwd: normalized.cwd,
      env: normalized.env,
      id: normalized.id,
      isDefault: normalized.setDefault,
      name: normalized.name,
      ...(normalized.sidebarGroupId
        ? { sidebarGroupId: normalized.sidebarGroupId }
        : {}),
      shell: normalized.shell,
      sortOrder: normalized.sortOrder,
      updatedAt: "browser-preview",
    };
  }

  return invoke<TerminalProfile>("profile_update", {
    request: normalizeUpdateRequest(request),
  });
}

export async function deleteProfile(profileId: string): Promise<boolean> {
  return invoke<boolean>("profile_delete", { profileId });
}

function normalizeCreateRequest(
  request: ProfileCreateRequest,
): NormalizedProfileRequest {
  return {
    ...request,
    args: request.args ?? [],
    cwd: request.cwd ?? undefined,
    env: request.env ?? {},
    setDefault: request.setDefault ?? false,
  };
}

function normalizeUpdateRequest(
  request: ProfileUpdateRequest,
): NormalizedProfileUpdateRequest {
  return {
    ...request,
    args: request.args ?? [],
    cwd: request.cwd ?? undefined,
    env: request.env ?? {},
    setDefault: request.setDefault ?? false,
  };
}
