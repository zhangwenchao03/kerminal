import type {
  ExternalLaunchMaterializedTarget,
  ExternalSshLaunchRequest,
} from "../../lib/externalLaunchApi";

export type ExternalSshLaunchResolvedRequest = ExternalSshLaunchRequest & {
  materialized?: ExternalLaunchMaterializedTarget;
  target: ExternalSshLaunchRequest["target"] & { username: string };
};

const sourceToolLabels: Record<
  ExternalSshLaunchRequest["source"]["tool"],
  string
> = {
  "kerminal-native": "Kerminal",
  mobaxterm: "MobaXterm",
  openssh: "OpenSSH",
  putty: "PuTTY",
  securecrt: "SecureCRT",
  xshell: "Xshell",
};

export function externalSshLaunchNeedsUsername(
  launch: ExternalSshLaunchRequest,
): boolean {
  return !launch.target.username?.trim();
}

export function resolveExternalSshLaunchUsername(
  launch: ExternalSshLaunchRequest,
  username: string,
): ExternalSshLaunchResolvedRequest {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("SSH username is required");
  }
  return {
    ...launch,
    target: {
      ...launch.target,
      username: normalizedUsername,
    },
  };
}

export function applyExternalSshLaunchMaterializedTarget(
  launch: ExternalSshLaunchResolvedRequest,
  materialized: ExternalLaunchMaterializedTarget,
): ExternalSshLaunchResolvedRequest {
  const username = materialized.username.trim();
  if (!username) {
    throw new Error("SSH username is required");
  }
  return {
    ...launch,
    materialized,
    options: {
      ...launch.options,
      displayName: materialized.displayName || launch.options.displayName,
    },
    target: {
      ...launch.target,
      host: materialized.host,
      port: materialized.port,
      username,
    },
  };
}

export function externalSshLaunchDisplayName(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
): string {
  const materializedName = materializedTarget(launch)?.displayName.trim();
  if (materializedName) {
    return materializedName;
  }
  const explicitName = launch.options.displayName?.trim();
  if (explicitName) {
    return explicitName;
  }
  const username = launch.target.username?.trim();
  return username ? `${username}@${launch.target.host}` : launch.target.host;
}

export function externalSshLaunchDescription(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
): string {
  const username = launch.target.username?.trim() || "ssh";
  return `${username}@${launch.target.host}:${launch.target.port} · ${externalSshLaunchSourceLabel(
    launch,
  )}`;
}

export function externalSshLaunchSourceLabel(
  launch: ExternalSshLaunchRequest,
): string {
  return sourceToolLabels[launch.source.tool] ?? launch.source.tool;
}

export function externalSshLaunchAuthType(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
): "password" | "key" | "agent" {
  const materializedAuthType = materializedTarget(launch)?.authType;
  if (materializedAuthType) {
    return materializedAuthType;
  }
  if (launch.auth.hasPassword) {
    return "password";
  }
  if (launch.auth.identityFile || launch.auth.hasKeyPassphrase) {
    return "key";
  }
  return "agent";
}

export function externalSshLaunchMachineId(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
) {
  return materializedTarget(launch)?.targetId ?? `external:${launch.id}`;
}

export function externalSshLaunchTags(launch: ExternalSshLaunchRequest) {
  return ["external", launch.source.tool];
}

export function formatExternalSshLaunchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function materializedTarget(
  launch: ExternalSshLaunchRequest | ExternalSshLaunchResolvedRequest,
) {
  return "materialized" in launch ? launch.materialized : undefined;
}
