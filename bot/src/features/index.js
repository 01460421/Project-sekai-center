/* 100 個功能的靜態清單（Discord 每個應用程式最多 100 個全域斜線指令，registry 測試會擋）。用靜態 import 而不是掃目錄，是為了讓 Cloudflare Workers（無檔案系統）也能打包。 */
import divination from './01-divination.js';
import personality from './02-personality.js';
import social from './03-social.js';
import games from './04-games.js';
import fun from './05-fun.js';
import economy from './06-economy.js';
import gacha from './07-gacha.js';
import quiz from './08-quiz.js';
import community from './09-community.js';
import server from './10-server.js';
import ai from './11-ai.js';

export default [...divination, ...personality, ...social, ...games, ...fun, ...economy, ...gacha, ...quiz, ...community, ...server, ...ai];
