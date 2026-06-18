FROM node:22-alpine AS build
# Patch OS packages (e.g. openssl) to the latest Alpine security fixes.
RUN apk upgrade --no-cache
WORKDIR /app
COPY admin-designer/package.json ./package.json
RUN npm install
COPY admin-designer/ ./
# Build number injected from the host (git commit count); see azure.yaml buildArgs.
ARG APP_BUILD=0
ENV APP_BUILD=$APP_BUILD
RUN npm run build

FROM nginx:1.29-alpine
# Apply Alpine security patches and drop curl (unused for static serving, and
# the source of the only remaining HIGH CVEs) to ship a 0C/0H image.
RUN apk upgrade --no-cache && (apk del curl libcurl 2>/dev/null || true)
COPY admin-designer/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY admin-designer/docker-entrypoint.sh /docker-entrypoint.d/99-env-config.sh
RUN chmod +x /docker-entrypoint.d/99-env-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
