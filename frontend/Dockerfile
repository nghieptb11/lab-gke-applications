# Stage 1: Build React App
FROM node:18-alpine AS build-stage

WORKDIR /app

# Copy package files để install dependencies trước (tối ưu layer cache)
COPY package*.json ./
RUN npm install

# Copy toàn bộ code frontend và build
COPY . .
RUN npm run build

# Stage 2: Phục vụ bằng Nginx
FROM nginx:alpine

# Copy file cấu hình Nginx custom (quan trọng cho React Router)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy các file đã build từ Stage 1 sang Stage 2
COPY --from=build-stage /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]