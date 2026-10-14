FROM node:24.21.0-bookworm-slim
WORKDIR /app
COPY index.js package.json ./
USER node
EXPOSE 3000
CMD ["node", "index.js"]
