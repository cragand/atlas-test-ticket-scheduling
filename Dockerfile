# Build stage - compiles TypeScript to dist/
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage - only production dependencies + the compiled output, no
# TypeScript source or devDependencies (ts-jest, jest, ts-node, etc.) needed
# once the app is actually running.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
CMD ["node", "dist/app.js"]
