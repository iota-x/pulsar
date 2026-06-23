# Single image for the whole web3-zapier stack. Each service in
# docker-compose.prod.yml runs a different command from this image.
FROM node:20-slim

# openssl (Prisma) + ca-certificates (HTTPS) + a toolchain for native addons
# (bcrypt, bufferutil) that compile with node-gyp.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all workspace dependencies.
COPY . .
RUN npm install

# Generate the Prisma client from the backend schema.
RUN npm run db:generate

# Build the Next.js frontend. NEXT_PUBLIC_* are inlined at build time, so the
# public API URL must be known here (passed as a build arg from compose).
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production
RUN npm run build --workspace=frontend

# Default command (overridden per-service in compose).
CMD ["npx", "tsx", "apps/backend/src/index.ts"]
