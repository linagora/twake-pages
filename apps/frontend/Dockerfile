FROM --platform=$BUILDPLATFORM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/
RUN npm ci --workspace @twake-pages/frontend --include-workspace-root --no-audit --no-fund
COPY apps/frontend apps/frontend
RUN npm run build --workspace @twake-pages/frontend

FROM nginxinc/nginx-unprivileged:1.31-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/frontend/docker/nginx.conf /etc/nginx/nginx.conf
COPY --chmod=755 apps/frontend/docker/40-twake-pages-runtime.sh /docker-entrypoint.d/
COPY --from=build /app/apps/frontend/dist /usr/share/nginx/html
RUN /docker-entrypoint.d/40-twake-pages-runtime.sh \
 && nginx -t -q \
 && rm -rf /tmp/nginx /tmp/nginx.pid
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
CMD ["nginx", "-g", "daemon off;"]
