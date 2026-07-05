// pm2 start ops/pm2.config.cjs && pm2 save
// Assumes `mise run boot:infra` (or the launchd infra job) has brought up postgres + inngest.
const repo = require("node:path").resolve(__dirname, "..");

module.exports = {
  apps: [
    {
      name: "dfarm-web",
      cwd: `${repo}/apps/web`,
      script: "./node_modules/.bin/next",
      args: "start -p 3100",
      env: {
        DATABASE_URL: "postgres://dfarm:dfarm@localhost:5442/dfarm",
        INNGEST_DEV: "1",
        INNGEST_BASE_URL: "http://localhost:8288",
        DFARM_ARTIFACTS_DIR: `${repo}/.artifacts`,
      },
      max_restarts: 10,
      restart_delay: 2000,
    },
    {
      name: "dfarm-agent",
      cwd: `${repo}/apps/agent`,
      script: "bun",
      args: "run src/main.ts",
      interpreter: "none",
      env: {
        DFARM_URL: "http://localhost:3100",
        DFARM_AGENT_PORT: "4700",
        DFARM_AGENT_URL: "http://localhost:4700",
        DFARM_AGENT_HOST: "local-mac",
        DFARM_ARTIFACTS_DIR: `${repo}/.artifacts`,
      },
      max_restarts: 10,
      restart_delay: 2000,
    },
  ],
};
