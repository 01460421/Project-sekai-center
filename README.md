# Project SEKAI 資源中心

世界計畫 彩色舞台 feat. 初音未來 資訊整合網站

## 功能

- 📅 活動日曆 - 卡池開放時間視覺化
- 🎰 卡池列表 - 台服卡池時間表
- 🎵 歌曲資料庫 - 完整樂曲清單
- 🔢 EP 計算器 - 精確 EP 計算、活動試算、控分工具

## 頁面

| 頁面 | 說明 |
|------|------|
| `index.html` | 資源中心首頁（日曆、活動、卡池、歌曲、社群連結） |
| `ep-calculator.html` | EP 計算器（曲庫 640 首、EP 計算、活動試算、控分） |

## EP 計算器

基於 [sekai-calculator](https://github.com/pjsek-ai/sekai-calculator) v0.17 公式精確計算。

- **曲庫** — 640 首歌曲，含各難度等級、音符數、時長、event rate
- **EP 計算** — 支援個人/自動/協力/對戰，含時間效率 TOP 15
- **活動試算** — 目標 EP 所需場次、時間、體力
- **控分** — Score Art 組合搜尋（Envy + MySekai EP）

## 資料來源

- 歌曲資料：[sekai-master-db-diff](https://github.com/Sekai-World/sekai-master-db-diff)
- EP 公式：[sekai-calculator](https://github.com/pjsek-ai/sekai-calculator) v0.17
- 體力倍率：遊戲內 boosts.json 驗證

## 部署

靜態網站，直接部署至 Vercel：

```bash
vercel
```

或本地開啟 `index.html`
