# backend/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Install deps
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Generate Prisma client (no migrations here)
RUN npx prisma generate

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "src/server.js"]
