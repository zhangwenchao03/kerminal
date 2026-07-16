import type {
  DockerContainerInfoRequest,
  DockerContainerInspectSummary,
  DockerContainerListRequest,
  DockerContainerStatsRequest,
  DockerContainerStatsResult,
  DockerContainerSummary,
} from "../../../lib/dockerApi";
import type { Machine } from "../../workspace/contracts/index";
import type { HostContainerLifecycleAction } from "./hostContainerDialogModel";

export interface HostContainersDialogProps {
  host: Machine;
  initialContainerId?: string;
  onClose: () => void;
  onEnterContainer: (container: DockerContainerSummary) => void;
  onFetchContainerStats: (request: DockerContainerStatsRequest) => Promise<DockerContainerStatsResult>;
  onInspectContainer: (request: DockerContainerInfoRequest) => Promise<DockerContainerInspectSummary>;
  onLifecycleContainer: (
    action: HostContainerLifecycleAction,
    container: DockerContainerSummary,
    options?: { force?: boolean },
  ) => void | Promise<void>;
  onListDockerContainers: (request: DockerContainerListRequest) => Promise<DockerContainerSummary[]>;
  onOpenContainerLogs: (container: DockerContainerSummary) => void;
  onPinContainer: (container: DockerContainerSummary) => void | Promise<void>;
  open: boolean;
}
