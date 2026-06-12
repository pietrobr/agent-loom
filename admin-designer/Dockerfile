FROM node:20-alpine AS build
WORKDIR /app
COPY admin-designer/package.json ./package.json
RUN npm install
COPY admin-designer/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY admin-designer/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY admin-designer/docker-entrypoint.sh /docker-entrypoint.d/99-env-config.sh
RUN chmod +x /docker-entrypoint.d/99-env-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
