FROM node:22-alpine AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.d/10-basic-auth.sh /docker-entrypoint.d/
COPY --from=build /src/dist /usr/share/nginx/html
