FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 FORTNOX_TOKEN_FILE=/data/fortnox-tokens.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "dist/index.js"]
