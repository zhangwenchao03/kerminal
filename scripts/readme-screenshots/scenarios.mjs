import {
  clickSelector,
  clickExpression,
  clickTextButtonContaining,
  contextClickExpression,
  delay,
  pressKey,
  waitForBrowserExpression,
} from "./helpers.mjs";

export const captures = [
  { name: "kerminal-hero.png", setup: captureHero },
  { name: "kerminal-connect.png", setup: captureConnectDialog },
  { name: "kerminal-external-launch.png", setup: captureExternalLaunch },
  { name: "kerminal-settings.png", setup: captureSettings },
  { name: "kerminal-docker.png", setup: captureDockerDialog },
  { name: "kerminal-gpu.png", setup: captureServerInfo },
  { name: "kerminal-agent.png", setup: captureAgentLauncher },
  { name: "kerminal-tmux.png", setup: captureTmux },
  { name: "kerminal-ports.png", setup: capturePorts },
  { name: "kerminal-sftp.png", setup: captureSftp },
  { name: "kerminal-file-tab.png", setup: captureWorkspaceFileTab },
];

async function captureHero(client) {
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="prod-api xterm 终端"]') !== null`,
    120_000,
  );
}

async function captureConnectDialog(client) {
  await clickSelector(client, `[aria-label="添加连接"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("添加连接") || document.body.innerText.includes("连接")`,
    20_000,
  );
}

async function captureExternalLaunch(client) {
  await pressKey(client, "Escape");
  await clickSelector(client, `[aria-label="打开设置"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-controls="settings-external-launch-panel"]') !== null`,
    20_000,
  );
  await clickSelector(client, `[aria-controls="settings-external-launch-panel"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("外部 SSH 启动") && document.body.innerText.includes("PuTTY / MobaXterm / Xshell / SecureCRT")`,
    20_000,
  );
}

async function captureDockerDialog(client) {
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("新建主机")`,
    10_000,
  );
  await contextClickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).find((button) => button.textContent?.includes("prod-api"))`,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="主机操作菜单"]') !== null && document.body.innerText.includes("容器")`,
    10_000,
  );
  await clickTextButtonContaining(client, "容器");
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("kerminal-stack") && document.querySelector('[aria-label^="打开 Compose YAML"]') !== null`,
    20_000,
  );
}

async function captureServerInfo(client) {
  await pressKey(client, "Escape");
  await waitForBrowserExpression(
    client,
    `!document.body.innerText.includes("kerminal/api:latest")`,
    10_000,
  );
  await clickSelector(client, `[aria-label="打开 系统"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("GPU") && document.body.innerText.includes("2 张显卡")`,
    30_000,
  );
  await clickSelector(client, `[aria-label="展开GPU详情"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("NVIDIA RTX 4090")`,
    10_000,
  );
}

async function captureAgentLauncher(client) {
  await clickSelector(client, `[aria-label="打开 Agent Launcher"]`);
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="Open Codex"]') !== null && document.querySelector('[aria-label="Open Claude"]') !== null`,
    30_000,
  );
}

async function captureTmux(client) {
  await clickSelector(client, `[aria-label="打开 tmux"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("release-watch") && document.body.innerText.includes("tmux 3.5a")`,
    30_000,
  );
}

async function capturePorts(client) {
  await clickSelector(client, `[aria-label="打开 端口"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("API tunnel") && document.body.innerText.includes("运行中")`,
    30_000,
  );
}

async function captureSftp(client) {
  await pressKey(client, "Escape");
  await clickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="左栏视图"] button')).find((button) => button.textContent?.includes("主机"))`,
  );
  await waitForBrowserExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).some((button) => button.textContent?.includes("prod-api"))`,
    10_000,
  );
  await contextClickExpression(
    client,
    `Array.from(document.querySelectorAll('[aria-label="主机侧边栏"] button')).find((button) => button.textContent?.includes("prod-api"))`,
  );
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="主机操作菜单"]') !== null && document.body.innerText.includes("新建传输 Tab")`,
    10_000,
  );
  await clickTextButtonContaining(client, "新建传输 Tab");
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="SFTP 传输工作台"]') !== null && document.body.innerText.includes("release-2026-06-23.tar.gz")`,
    30_000,
  );
}

async function captureSettings(client) {
  await pressKey(client, "Escape");
  await clickSelector(client, `[aria-label="打开设置"]`);
  await delay(2_000);
  await clickSelector(client, `[aria-controls="settings-terminal-panel"]`);
  await delay(1_000);
}

async function captureWorkspaceFileTab(client) {
  const workspaceFileSession = {
    activeTabId: "tab-env-file",
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
          "deploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\\r\\nNAMES        STATUS\\r\\napi          Up 12 minutes\\r\\nworker       Up 8 minutes\\r\\n",
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
      {
        access: "editable",
        id: "tab-env-file",
        kind: "workspaceFile",
        machineId: "prod-api",
        path: "/srv/kerminal/.env",
        rootPath: "/srv/kerminal",
        source: "sftp",
        target: { hostId: "prod-api", kind: "ssh" },
        title: ".env",
      },
    ],
    version: 1,
  };
  await client.send("Runtime.evaluate", {
    expression: `localStorage.setItem("kerminal.readme.capture.session.override", ${JSON.stringify(JSON.stringify(workspaceFileSession))})`,
  });
  await client.send("Page.reload", { ignoreCache: true });
  await waitForBrowserExpression(
    client,
    `document.querySelector('[data-testid="workspace-file-tab-surface"]') !== null && document.body.innerText.includes("KERMINAL_MODE=production")`,
    60_000,
  );
}
