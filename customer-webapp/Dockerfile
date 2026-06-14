FROM node:22-alpine AS build
# Patch OS packages (e.g. openssl) to the latest Alpine security fixes.
RUN apk upgrade --no-cache
WORKDIR /app
COPY customer-webapp/package.json ./package.json
RUN npm install
COPY customer-webapp/ ./
RUN npm run build

FROM nginx:1.29-alpine
# Apply Alpine security patches and drop curl (unused for static serving, and
# the source of the only remaining HIGH CVEs) to ship a 0C/0H image.
RUN apk upgrade --no-cache && (apk del curl libcurl 2>/dev/null || true)
COPY customer-webapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY customer-webapp/docker-entrypoint.sh /docker-entrypoint.d/99-env-config.sh
RUN chmod +x /docker-entrypoint.d/99-env-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
