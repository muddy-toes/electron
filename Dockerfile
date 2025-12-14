# Build stage - compile native dependencies
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy built node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code (includes .git for version detection)
COPY . .

# Create directory for persistent data
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

CMD ["node", "index.js"]
