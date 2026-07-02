import {
  clickSelector,
  clickTextButtonContaining,
  contextClickExpression,
  delay,
  pressKey,
  waitForBrowserExpression,
} from "./helpers.mjs";

export const captures = [
  { name: "kerminal-hero.png", setup: captureHero },
  { name: "kerminal-connect.png", setup: captureConnectDialog },
  { name: "kerminal-settings.png", setup: captureSettings },
  { name: "kerminal-docker.png", setup: captureDockerDialog },
  { name: "kerminal-gpu.png", setup: captureServerInfo },
  { name: "kerminal-agent.png", setup: captureAgentLauncher },
  { name: "kerminal-tmux.png", setup: captureTmux },
  { name: "kerminal-sftp.png", setup: captureSftp },
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
  await pressKey(client, "Escape");
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
