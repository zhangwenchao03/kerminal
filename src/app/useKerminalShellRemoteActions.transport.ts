export { openSavedRdpConnection } from "../lib/connectionApi";
export { closeExternalSshLaunch } from "../lib/externalLaunchApi";
export {
  createProfile,
  listProfiles,
  updateProfile,
  type TerminalProfile,
} from "../lib/profileApi";
export {
  createRemoteHost,
  createRemoteHostGroup,
  deleteRemoteHost,
  deleteRemoteHostGroup,
  listRemoteHostTree,
  UNGROUPED_REMOTE_HOST_GROUP_ID,
  updateRemoteHost,
  updateRemoteHostGroup,
  type RemoteHost,
  type RemoteHostCreateRequest,
  type RemoteHostGroup,
  type RemoteHostGroupUpdateRequest,
} from "../lib/remoteHostApi";
