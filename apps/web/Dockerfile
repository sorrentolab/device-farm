FROM node:24

WORKDIR /app

RUN npm i -g bun

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY e2e/package.json e2e/package.json

RUN bun install --frozen-lockfile

COPY apps/web apps/web
COPY packages/shared packages/shared

RUN bun run --cwd apps/web build

EXPOSE 3100

CMD ["sh", "-c", "cd /app/apps/web && bunx drizzle-kit migrate && ./node_modules/.bin/next start -p 3100"]
