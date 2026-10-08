FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/
RUN npm ci --workspace @twake-pages/backend --include-workspace-root
COPY apps/backend apps/backend
RUN npm run build --workspace @twake-pages/backend

FROM build AS deps
RUN npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY apps/backend/package.json apps/backend/
COPY apps/backend/drizzle apps/backend/drizzle
COPY --from=build /app/apps/backend/dist apps/backend/dist
WORKDIR /app/apps/backend
USER 1000:1000
EXPOSE 8080
CMD ["node", "dist/main.js"]
