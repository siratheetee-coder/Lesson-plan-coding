# Production container for Easy ENG Plan (Node.js + static frontend).
# Frontend served as static files by express.static (no build step).
# Works on Koyeb, Fly.io, Railway, Render, Cloud Run.

FROM node:20-alpine

WORKDIR /app

# Install server deps first (cache layer)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy everything else (frontend at root + server source)
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "server.js"]
