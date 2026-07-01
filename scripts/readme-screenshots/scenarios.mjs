import {
  clickSelector,
  clickTextButtonContaining,
  contextClickExpression,
  evaluate,
  pressKey,
  waitForBrowserExpression,
} from "./helpers.mjs";

export const captures = [
  { name: "kerminal-hero.png", setup: captureHero },
  { name: "kerminal-connect.png", setup: captureConnectDialog },
  { name: "kerminal-docker.png", setup: captureDockerDialog },
  { name: "kerminal-gpu.png", setup: captureServerInfo },
  { name: "kerminal-agent.png", setup: captureAgentLauncher },
  { name: "kerminal-tmux.png", setup: captureTmux },
  { name: "kerminal-sftp.png", setup: captureSftp },
  { name: "kerminal-settings.png", setup: captureSettings },
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
    `document.body.innerText.includes("kerminal-stack") && document.body.innerText.includes("Compose YAML")`,
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

async function captureSftp(client) {
  const session = sftpWorkspaceSession();
  await evaluate(
    client,
    `(() => {
      localStorage.setItem(
        "kerminal.readme.capture.session.override",
        ${JSON.stringify(JSON.stringify(session))},
      );
    })()`,
  );
  await client.send("Page.reload", { ignoreCache: false });
  await waitForBrowserExpression(
    client,
    `document.querySelector('[aria-label="SFTP 传输工作台"]') !== null && document.body.innerText.includes("release-2026-06-23.tar.gz")`,
    30_000,
  );
}

async function captureSettings(client) {
  await clickSelector(client, `[aria-label="打开设置"]`);
  await waitForBrowserExpression(
    client,
    `document.body.innerText.includes("主题") && document.body.innerText.includes("终端外观")`,
    30_000,
  );
}


function sftpWorkspaceSession() {
  return {
    activeTabId: "tab-sftp-transfer-1",
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
          "deploy@prod-api:/srv/kerminal$ docker ps --format 'table {{.Names}}\\t{{.Status}}'\r\nNAMES        STATUS\r\napi          Up 12 minutes\r\nworker       Up 8 minutes\r\n",
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
        id: "tab-sftp-transfer-1",
        kind: "sftpTransfer",
        machineId: "prod-api",
        rightHostId: "prod-api",
        title: "SFTP 传输",
      },
    ],
    version: 1,
  };
}
