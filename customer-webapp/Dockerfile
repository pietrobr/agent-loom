FROM node:20-alpine AS build
WORKDIR /app
COPY customer-webapp/package.json ./package.json
RUN npm install
COPY customer-webapp/ ./
RUN npm run build

FROM nginx:1.27-alpine
COPY customer-webapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
COPY customer-webapp/docker-entrypoint.sh /docker-entrypoint.d/99-env-config.sh
RUN chmod +x /docker-entrypoint.d/99-env-config.sh
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
