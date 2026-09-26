# 容器版（Gateway 完整功能）。建置上下文是 repo 根目錄，因為機器人要讀根目錄 data/ 的五個資料檔：
#   docker build -f bot/Dockerfile -t sekai-center-bot .
#   docker run -d --name sekai-bot --restart unless-stopped --env-file bot/.env -v sekai-bot-data:/data sekai-center-bot
# 也可直接拉 GitHub Actions 建好的映像：ghcr.io/01460421/sekai-center-bot:latest
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app/bot

COPY bot/package.json bot/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY data/cards-index.js data/cards-extra.js data/ep-songs.js data/sekai-data.js data/song-bpm.js /app/data/
COPY bot/src ./src
COPY bot/scripts ./scripts

# 玩家資料放 /data（掛 volume 就不會隨容器消失）
RUN mkdir -p /data && chown node:node /data
USER node
ENV STATE_FILE=/data/state.json
VOLUME ["/data"]

CMD ["node", "src/index.js"]
