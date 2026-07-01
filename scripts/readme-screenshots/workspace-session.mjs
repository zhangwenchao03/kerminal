export const defaultWorkspaceSession = {
  activeTabId: "tab-prod-api",
  focusedPaneId: "pane-prod-api",
  removedSidebarMachineIds: [],
  selectedMachineId: "prod-api",
  sidebarMachines: [],
  terminalPanes: [
    {
      currentCwd: "/srv/kerminal",
      cwd: "/srv/kerminal",
      id: "pane-prod-api",
      lines: [],
      machineId: "prod-api",
      mode: "ssh",
      outputHistory:
        "deploy@prod-api:/srv/kerminal$ git status --short\r\n M src/features/tool-panel/AgentLauncherToolContent.tsx\r\n M src/features/machine-sidebar/RemoteHostCreateDialog.tsx\r\ndeploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\r\nNAMES        STATUS\r\napi          Up 12 minutes\r\nworker       Up 8 minutes\r\n",
      prompt: "deploy@prod-api:/srv/kerminal$",
      remoteHostId: "prod-api",
      remoteHostProduction: false,
      status: "online",
      target: { hostId: "prod-api", kind: "ssh" },
      title: "prod-api",
    },
  ],
  terminalTabs: [
    {
      id: "tab-prod-api",
      layout: { paneId: "pane-prod-api", type: "pane" },
      machineId: "prod-api",
      title: "prod-api",
    },
  ],
  version: 1,
};
