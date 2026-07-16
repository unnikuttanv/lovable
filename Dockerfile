FROM node:22-alpine
WORKDIR /app

COPY server/package*.json server/
RUN npm ci --prefix server --omit=dev

# runner needs devDependencies (vite) — it is the publish build engine
COPY runner/package*.json runner/
RUN npm ci --prefix runner

COPY server server
COPY runner runner
COPY client client

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
CMD ["node", "server/src/index.js"]
