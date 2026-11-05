# 工單：《重返未來：1999》實戰出牌戰鬥模擬器

| 欄位 | 內容 |
|---|---|
| 代號 | `r1999-sim` |
| 目標 | 在本站內做出一個**逐回合、逐張牌、逐點傷害都對得上真機**的戰鬥模擬器 |
| 分支 | `claude/back-to-1999-card-battle-40l9vo` |
| 狀態 | 規格草案，待評估後拆單 |
| 預估 | 核心引擎 6～8 人週；資料錄入另計（見 §11，那才是大頭） |

---

## TL;DR

這不是「做一個卡牌小遊戲」，是**重建一套別人不公開的規則引擎**。難點依序是：

1. **資料**：技能倍率、卡等效果、狀態定義、敵人數值——沒有任何現成的結構化來源。社群工具站（Kornblume 等）只有養成向資料（材料、掉落、洞悉消耗），**沒有一個字的戰鬥數值**。這是本案 60% 的工作量。
2. **未公開的計算細節**：取整位置、加成分區（加法區還是乘法區）、ATK−DEF 是否有保底、暴擊傷害與暴擊防禦是相減還是相乘。這些只能用遊戲內對照實驗反推，必須排進工期（§18）。
3. **效果系統**：130+ 角色、每角色 2 法術 ×3 卡等 + 1 大招 + 被動 + 共鳴 + 心相 + 狂歡，全部會掛鉤到傷害流程的不同時機。沒有一套嚴謹的時機窗與優先序模型，做到第 30 個角色就會崩。

引擎本身（回合、AP、抽牌、合牌、Moxie）反而是最單純的部分。

---

## 0. 這份工單怎麼用

- §2 是**規則盤點**：每條標了「已查證」或「待驗證」。已查證的直接寫進實作；待驗證的一律走 §18 的實驗流程，**不准憑印象填數字**。
- §4～§10 是**規格**，可以直接照著寫程式。
- §11、§12 回答「需要什麼資料跟素材」。
- §19 是**可指派的子工單**，帶編號、依賴、驗收條件。

---

## 1. 目標與非目標

### 目標

- **G1 忠實度**：給定同一套隊伍配置、同一個關卡、同一串操作，模擬器每一次傷害數字與真機一致（誤差 ≤ 1，且誤差來源必須能解釋）。
- **G2 決定性**：同一個 seed + 同一串操作 → 逐事件完全相同的結果。可重播、可分享、可回歸測試。
- **G3 可批次**：能在 Worker 裡跑 10,000 場蒙地卡羅，輸出傷害分布、通關率、AP 效率，而不是只能人工玩一場。
- **G4 資料驅動**：新角色只要新增一筆資料就能上線，不用改引擎。
- **G5 可解釋**：每一次傷害都能展開成「哪一段乘了多少」的明細，這是模擬器對玩家的核心價值（真機不給你看這個）。

### 非目標

- ❌ 不重製遊戲客戶端、不打包官方美術與音樂（§17）。
- ❌ 不做劇情、養成、抽卡、體力等系統。只做**戰鬥**。
- ❌ 不做即時多人。
- ❌ 第一版不追求 100% 角色覆蓋率；追求**引擎覆蓋 100% 的機制種類**，角色資料逐步補。

---

## 2. 遊戲機制盤點

> 標記說明：**[V]** = 已由公開來源查證（來源見 §21）；**[?]** = 待驗證，必須跑 §18 的實驗。

### 2.1 回合骨架

- **[V]** 回合制，我方與敵方各行動一次為一回合。
- **[?]** 回合內的精確相位順序（我方出完牌→敵方一次全部行動？還是有先後速度判定？）、敵方行動預告的產生時機。
- **[?]** 是否有回合上限、超時判定、以及「重返」（重試）對狀態的影響。

### 2.2 AP 與手牌

- **[V]** **AP = 場上角色數**。一般 3 人在場 → 每回合 3 AP；某些 Boss 戰 4 人在場 → 4 AP；場上剩 2 人 → 2 AP。
- **[V]** **每一個動作耗 1 AP**：出牌、移動卡片、放大招，都算。
- **[V]** **手牌上限 = 場上角色 ×2 + 後備角色 ×1**（標準隊 3 上場 + 1 後備 = 7）。
- **[V]** 我方成員死亡且無替補時，會**佔用一格手牌**（等於上限實質下降）。
- **[V]** 回合開始時補牌至上限，來源是場上角色的共用牌庫，隨機。
- **[?]** 抽牌是否等權重？是否有「不會連續給同一張」之類的保底？大招牌插入手牌的位置規則？手牌滿時的溢出處理？

### 2.3 卡牌等級與合成

- **[V]** 卡有 1／2／3 三個等級，同角色同技能同等級兩張可合成高一級，3 級封頂。
- **[V]** 合成消耗 1 AP，並讓該角色 +1 Moxie。
- **[V]** **高等級不等於單純倍率變大**。實例：某張牌 1 級是 200% 現實傷害，3 級變 300%，但 **2 級傷害與 1 級相同、改為附加減益效果並換了標籤**。
  → **這是資料模型的關鍵約束：每張牌的每一個等級都要是獨立的一份效果腳本，不能用「基礎倍率 × 等級係數」偷懶。**
- **[?]** 合成後的牌是否繼承任何狀態（例如被增益的牌）。

### 2.4 Moxie 與大招

- **[V]** Moxie 上限 5。
- **[V]** 獲得方式：施放法術 +1、合成卡片 +1、移動卡片 +1。
- **[V]** Moxie 集滿 5 之後，**下一回合開始時**該角色的大招牌才會生成到手牌。
- **[V]** 大招牌從手牌打出，**照樣消耗 1 AP**（除非帶有「施放大招不消耗 AP」類的增益，例如 Empower Incantation）。
- **[?]** 大招施放後 Moxie 是歸零還是扣 5；大招牌未使用時是否留到下回合；有沒有第二張大招同時存在的情況。
- **[?]** 敵方是否共用同一套 Moxie 規則。

### 2.5 調率（Tuning）

- **[V]** 調率技能**不消耗 AP**，消耗獨立的「調率條」。
- **[V]** 戰鬥中通常有兩個調率技能，任何時候都能用（不限自己回合）。
- **[V]** 效果類型包含：重整手牌／產生一張萬用合成牌。
- **[?]** 調率條的累積規則（每回合固定回復？出牌累積？）、每個調率技能的消耗量、是否有戰鬥內次數上限。

### 2.6 屬性克制（Afflatus）

- **[V]** 六屬性：獸 Beast、木 Plant、星 Star、岩 Mineral、靈 Spirit、智 Intellect。
- **[V]** 克制圈（**四元環**，不是兩個三角）：**獸 → 木 → 星 → 岩 → 獸**。
- **[V]** 靈 ⇄ 智 **互相**克制，且不在上面那個環裡。
- **[V]** 克制時傷害 **×1.3**；**被克制沒有懲罰**（與同屬性、無關屬性一樣是 ×1.0）。
- **[V]** 這一項與「增傷（DMG Bonus）」是獨立的乘區。

### 2.7 傷害類型與數值

- **[V]** 傷害類型：**現實（Reality）／精神（Mental）／始源（Genesis）**。現實傷害吃現實防禦、精神傷害吃精神防禦，**始源傷害無視防禦**。
- **[V]** 角色數值 7 項（依社群資料檔的欄位順序）：攻擊、生命、現實防禦、精神防禦、暴擊技巧、暴擊率、抗暴技巧。
- **[V]** **暴擊率 = 暴擊技巧 ÷ 30**，共鳴／心相等來源的暴擊率再加上去。已用實資料交叉驗證：某六星角色 3-60 的暴擊技巧 420、暴擊率欄位 14，420/30 = 14 ✅。
- **[V]** **穿透率**無視目標防禦，多來源以 `(1 − 穿透率)` **連乘**後作用在目標防禦上。
- **[V]** 社群整理的傷害式（原文照抄，**注意它本身就有歧義**）：
  ```
  DMG = ( Σ ( Final ATK − Final DEF Target ) × Penetration Rate × DEF Reduction )
        × Critical DMG − Critical DEF Target
        × DMG Bonus Multiplier
        × Incantation Might or Ultimate Might
        × Skill Multiplier
        × Afflatus Advantage
  ```
  歧義點（全部進 §18）：`× Critical DMG − Critical DEF` 到底是 `×(暴傷 − 暴防)` 還是 `×暴傷 ×(1−暴防)`；`Penetration Rate` 寫成乘在差值上但語意應是減防；`DMG Bonus` 與 `DMG Reduction` 是同一個加法區還是兩個乘區。
- **[V]** 面板攻擊／防禦的算法：`基礎值 × (1 + Σ百分比加成) + Σ固定加成`（先乘百分比再加固定值）。
- **[?]** `ATK − DEF` 為負時的下限（0？1？攻擊力的某個百分比保底？）。
- **[?]** 取整發生在哪幾步（每步取整 vs 只在最後取整；四捨五入 vs 無條件捨去）。
- **[V]** 減防（Reality/Mental DEF Down）的收益通常高於增傷，因為它作用在減法項上——這也是為什麼**減法防禦模型必須實作正確**，用「防禦率」近似會整組數字歪掉。

### 2.8 狀態效果

- **[V]** 同名狀態依**強度與持續時間**覆蓋（不是無腦疊加）。
- **[V]** 已知的機制種類（要當成分類骨架，不是完整清單）：
  | 類型 | 例子 | 引擎要支援的能力 |
  |---|---|---|
  | 封鎖類 | Seal（不能放大招）、Disarm（不能用傷害法術）、Silence（不能用增益／減益／治療／反擊法術） | 依**技能標籤**過濾可用牌 |
  | 命中修正 | Blind（降單體輸出）、Mis-Aim（降多體增傷） | 依**目標數量**分歧的修正 |
  | 持續傷害 | Nasty Wound（受治療 −10%，回合結束受 自身攻擊×30% 始源傷害，可疊、不可驅散） | 回合結束時機、傷害來源歸屬、不可驅散旗標 |
  | 受擊追傷 | Fracture（被攻擊時追加始源傷害） | 受擊時機窗 |
  | 行動修正 | Empower Incantation（放大招不耗 AP，放完即移除） | 改寫**行動成本**、自我消耗 |
  | 回合結算 | Vitalize（回合開始回滿已損血量） | 回合開始時機 |
  | 反傷 | Ricochet（反彈始源傷害） | 重入防護（反傷觸發反傷） |
- **[?]** 完整狀態清單與各自的疊加規則、層數上限、驅散分類（可驅散／不可驅散／不可被抵抗）。這份清單要靠資料錄入補齊。

### 2.9 養成系統（影響戰鬥面板，必須進模型）

- **[V]** **洞悉 I～III**：拉等級上限、給面板、解鎖被動。資料檔的面板斷點就是 `0-1 / 0-30 / 1-40 / 2-50 / 3-60`。
- **[?]** 斷點之間是否線性內插（要用遊戲內數值驗）。
- **[V]** **共鳴（Resonance）**：等級 2～15，另有形狀（如 Z-shape）之分，是面板的主要來源之一。
- **[V]** **心相（Psychube）**：每人裝一個，給面板 + 一個條件觸發被動；有塑造（Portray／Amplification）等級。
- **[V]** **狂歡（Euphoria）**：六星洞悉 III 30 級 / 五星洞悉 III 1 級解鎖，加被動、加面板、啟用「法術節奏（Incantation Cadence）」、有角色專屬的 Epiphany 分支。
- **[?]** 狂歡對出牌流程本身的改動（Incantation Cadence 具體改了什麼），這會直接影響引擎的抽牌／卡等邏輯，**必須在 M1 前釐清**，否則架構要重做。

---

## 3. 系統架構

### 3.1 分層

```
┌─────────────────────────────────────────────────────────┐
│ UI 層   r1999.html + js/r1999/ui/*.js（React，用 vendor）│
│         只訂閱 event log 播放，不碰規則                    │
├─────────────────────────────────────────────────────────┤
│ 應用層  js/r1999/app/*.js                                │
│         隊伍編成、關卡選擇、重播載入、批次模擬派工          │
├─────────────────────────────────────────────────────────┤
│ 模擬層  js/r1999/sim/*.js（Web Worker）                   │
│         蒙地卡羅、策略 AI、統計聚合                        │
├─────────────────────────────────────────────────────────┤
│ 引擎層  js/r1999/engine/*.js  ★純函式，無 DOM / 無時鐘 /   │
│         無 Math.random。唯一入口：apply(state, action)     │
├─────────────────────────────────────────────────────────┤
│ 資料層  data/r1999/*.js（ES module，靜態、版本化）         │
└─────────────────────────────────────────────────────────┘
```

**鐵律：引擎層不得 import UI 或資料以外的東西。** 資料以參數注入（`createBattle({ dataset, ... })`），不要在引擎裡 `import { ARCANISTS }`——否則批次模擬沒辦法同時跑兩個資料版本做回歸比對。

### 3.2 檔案結構（照本 repo 慣例，無建置步驟、ES module、Python 工具）

```
r1999.html                      新頁面（獨立，不塞進 app.html；app.html 已 1.3MB）
js/r1999/
  engine/
    rng.js                      決定性亂數（多流）
    state.js                    BattleState 建構、快照、深比較
    reducer.js                  apply(state, action) -> { state, events }
    flow.js                     回合／相位狀態機
    cards.js                    牌庫、抽牌、合成、手牌上限
    pipeline.js                 傷害／治療／護盾計算管線
    buckets.js                  加成分區定義（見 §6）
    effects.js                  狀態註冊表、生命週期、時機窗派發
    dsl.js                      技能腳本直譯器
    ai.js                       敵方行為腳本直譯器
    events.js                   事件型別常數與 schema
    invariants.js               不變量檢查（dev 模式開）
  sim/
    worker.js                   批次模擬 Worker
    policies.js                 出牌策略（貪婪／期望值／隨機／人工）
    stats.js                    分布統計
  ui/
    board.js  hand.js  unit.js  log.js  breakdown.js  loadout.js
  index.js                      對外 API
data/r1999/
  meta.js                       dataVersion、schema 版本、常數表
  arcanists.js                  角色（面板斷點、技能 id、被動、共鳴、狂歡）
  skills.js                     法術／大招（每卡等一份腳本）
  statuses.js                   狀態效果定義
  psychubes.js                  心相（面板 + 被動腳本）
  enemies.js                    敵人（面板、技能、AI）
  stages.js                     關卡（波次、規則、修正）
tools/
  build-r1999-data.py           抓取→正規化→驗證→輸出 data/r1999/*.js
  verify-r1999-data.py          schema 與引用完整性檢查（CI 跑）
  r1999-calibrate.py            黃金重播比對報表
tests/r1999/                    黃金重播與單元測試（見 §15）
docs/r1999-battle-sim.md        本文件
```

整合注意事項（本 repo 特有）：

- `tools/stamp-assets.py` 目前只戳 `js/ css/ data/ vendor/` 底下的 `.js`／`.css`，且用 `rglob`，**子目錄會被涵蓋**。所以資料一律寫成 `data/r1999/*.js`（`export const X = ...`）而不是 `.json`，才能吃到既有的 immutable 快取戳記機制。
- `vercel.json` 的 `/data/(.*)` 已是一年 immutable，新檔自動適用；`r1999.html` 要另外加一條 `must-revalidate` 的 route，跟其他 HTML 一致。
- 改完 `js/r1999/`、`data/r1999/` 之後，提交前務必 `python3 tools/stamp-assets.py`（README 已有此規範）。

### 3.3 為什麼是「純函式核心 + 事件流」

三個理由，缺一不可：

1. **決定性**：批次模擬要跑十萬場，任何隱藏狀態（時鐘、全域亂數、DOM）都會讓結果無法重現，bug 也無法重播。
2. **動畫與規則解耦**：UI 播動畫是慢的，規則是快的。引擎一次算完吐出 event log，UI 照 log 播；批次模擬則直接丟掉 log。若規則裡混了 `await animation()`，這件事永遠做不到。
3. **可測**：黃金重播測試是本案唯一能證明「模擬正確」的手段，而它要求「同輸入 → 同輸出」的純函式邊界。

**現成參考**：社群已有一個 Python 實作 `gululu1235/Reverse1999Simulator`，同樣採事件驅動狀態機，並額外做了 Gymnasium 強化學習環境。**建議 M0 花半天讀它的狀態機切分**（尤其 `battle_info/` 的 InfoProcessor 抽象），驗證我們的相位切法有沒有漏。它的操作集也印證了規則：`m 移動卡片 / u 出牌 / c1 調率-重整 / c2 調率-萬用牌 / e 結束回合`。

---

## 4. 領域模型

### 4.1 BattleState

```js
/**
 * 整份狀態必須可 structuredClone、可 JSON 序列化、不含函式。
 * 所有「規則」都在引擎裡，state 只有資料。
 */
const BattleState = {
  schema: 1,
  dataVersion: '2026.08-a',   // 對應 data/r1999/meta.js
  rng: { seed: '0x…', streams: { draw: 0, crit: 0, ai: 0, misc: 0 } },  // 各流的計數器
  round: 3,
  phase: 'player.action',     // 見 §5
  ap: { max: 3, left: 2 },
  tuning: { max: 100, cur: 40, skills: ['first_melody', 'grand_orchestra'] },
  allies: [Unit, Unit, Unit],           // 場上
  bench:  [Unit],                       // 後備
  enemies: [Unit, …],
  hand: [Card, …],
  deckState: { … },                     // 抽牌用的權重／保底狀態
  pendingUltimates: ['lilya'],          // 下回合開始要生成大招牌的角色
  seq: 812,                             // 全域單調遞增序號，用來決定同優先序的排序
  log: [Event, …]                       // 可選，批次模擬時關掉
}
```

### 4.2 Unit

```js
const Unit = {
  uid: 'a0',                  // 場上唯一
  side: 'ally' | 'enemy',
  refId: 'lilya',             // 對應資料層
  afflatus: 'star',
  level: { insight: 3, lv: 60 },
  build: { resonance: {...}, psychube: { id, portray }, euphoria: { unlocked, epiphany } },

  base:  { atk, hp, defReality, defMental, critTech, critResistTech },  // 由養成算出，戰鬥中不變
  cur:   { hp, shield },
  moxie: 3,
  statuses: [ { id, stacks, remaining, applierUid, appliedSeq, payload } ],
  flags:  { alive: true, taunting: false, actionLocked: false },
  // 快取：由 base + statuses 每次重算，不落地（避免髒快取）
}
```

**明確決定：面板不落地快取。** 每次計算傷害時從 `base + statuses + build` 現算一份 snapshot。理由是 buff 的疊加順序與時機遠比省下的那點 CPU 重要；真要優化再加 memo（key = statuses 的 seq 指紋）。

### 4.3 Card

```js
const Card = {
  cid: 'c17',
  ownerUid: 'a0',
  skillId: 'lilya_i1',
  kind: 'incantation' | 'ultimate' | 'wildcard',
  level: 2,                   // 1..3
  tags: ['attack'],           // 由技能該等級的資料帶出，Disarm/Silence 判定用
  locked: false,              // 某些效果會鎖牌
  bornSeq: 640                // 生成序號，決定手牌排序與同分打散
}
```

### 4.4 Action（外部唯一輸入）

```js
{ type: 'play',   cid, targetUid? }        // 出牌，1 AP
{ type: 'merge',  cid, ontoCid }           // 合成，1 AP，+1 moxie
{ type: 'move',   cid, toIndex }           // 移動，1 AP，+1 moxie
{ type: 'tune',   tuningId, args? }        // 調率，0 AP，消耗調率條
{ type: 'endTurn' }
{ type: 'switch', benchUid, fieldUid }     // 若有替補機制（待驗證）
```

### 4.5 Event（唯一輸出）

事件是 UI 的唯一資訊來源，也是黃金測試的比對對象。每個事件都要能單獨解釋。

```js
{ seq, type: 'damage', sourceUid, targetUid, dmgType, amount, crit,
  breakdown: { atkFinal, defFinal, penetration, afflatus, dmgBonus, might, mult, buckets: {...} } }
{ seq, type: 'heal' | 'shield' | 'status.apply' | 'status.remove' | 'status.tick' }
{ seq, type: 'card.draw' | 'card.merge' | 'card.play' | 'card.discard' }
{ seq, type: 'moxie.change' | 'ap.change' | 'tuning.change' }
{ seq, type: 'unit.death' | 'wave.clear' | 'battle.end', result }
{ seq, type: 'phase', from, to }
```

`breakdown` 是 **G5（可解釋）** 的實作，也是校準時對帳的依據——不要事後另外算一遍，直接由管線把每一段的中間值填進去。

---

## 5. 戰鬥狀態機

```
battle.start
  └─ wave.start                       敵人上場、開場被動、開場狀態
      └─ round.start                  ① 回合計數 +1
                                      ② 回合開始時機窗（Vitalize 之類）
                                      ③ 生成大招牌（pendingUltimates）
                                      ④ 補牌至手牌上限
                                      ⑤ 重算 AP（= 場上人數，含死亡佔位修正）
                                      ⑥ 調率條回復
                                      ⑦ 敵方行動預告（intent）產生
          └─ player.action  ←──┐      玩家送 Action；AP 歸零或 endTurn 才離開
              └─ resolve       │      每個 action 完整結算（含連鎖觸發）後回到 player.action
                  └───────────┘
          └─ player.end                我方回合結束時機窗
          └─ enemy.action              依預告執行，每個敵人結算完才換下一個
          └─ enemy.end                 敵方回合結束時機窗
          └─ round.end                 持續傷害結算、狀態倒數、到期移除
      └─ (勝負判定：全敵死→wave.clear；全我死／回合超限→battle.end)
```

**關鍵設計：`resolve` 是一個佇列，不是一個函式呼叫。**

一次出牌可能觸發：傷害 → 目標的 Fracture 追傷 → 追傷擊殺 → 擊殺觸發我方被動 → 被動施加狀態 → 狀態觸發對方反傷。這是一條可能無限遞迴的鏈。實作要求：

- 用**顯式的效果佇列**（FIFO）跑到空，不用 JS 呼叫堆疊遞迴。
- 有 `depth` 上限（建議 64）與 `stepBudget` 上限（建議 4096），超過就記一個 `engine.overflow` 事件並中止該鏈——**寧可留下可觀察的異常，也不要無聲當掉或無限迴圈**。
- 佇列處理期間新產生的事件排在隊尾，保證處理順序 = 產生順序，這樣才有決定性。

---

## 6. 傷害管線（分區設計）

管線切成有名字的**段（stage）**，每段有一個或多個**分區（bucket）**。效果不是「改一個數字」，而是「登記到某個分區」。這是整份規格裡最重要的一個決定：因為我們**還不知道**遊戲的加成是加法區還是乘法區（§2.7 的歧義），把分區做成資料，之後校準時只要改 `buckets.js` 的組合方式，不用重寫管線。

```js
// buckets.js —— 每個分區宣告它怎麼合併
export const BUCKETS = {
  atkPct:      { combine: 'sum'  },   // 攻擊力百分比：加法
  atkFlat:     { combine: 'sum'  },
  defPct:      { combine: 'sum'  },
  defFlat:     { combine: 'sum'  },
  penetration: { combine: 'prodComplement' },  // 1 - Π(1 - x)，已查證是連乘
  defDown:     { combine: 'sum'  },   // [?] 待驗證：加法還是連乘
  dmgBonus:    { combine: 'sum'  },   // [?] 待驗證：與 dmgReduction 同區還是異區
  dmgReduction:{ combine: 'sum'  },   // [?]
  critRate:    { combine: 'sum'  },
  critDmg:     { combine: 'sum'  },
  vulnerable:  { combine: 'sum'  },
  healBonus:   { combine: 'sum'  },
}
```

### 計算順序（每一步都要寫進 `breakdown`）

```
S1  攻方面板     atkFinal = base.atk × (1 + Σ atkPct) + Σ atkFlat
S2  守方面板     defRaw   = base.def{Reality|Mental} × (1 + Σ defPct) + Σ defFlat
                 始源傷害 → 直接跳到 S5，defEff = 0
S3  減防與穿透   defEff   = defRaw × (1 − pen) × (1 − defDown)
S4  減法基底     base     = atkFinal − defEff
                 [?] 下限規則：clamp(base, floorRule)   ← §18-E4 決定 floorRule
S5  技能        x = base × skillMult(level) × might(incantation|ultimate)
S6  增減傷       x ×= (1 + Σ dmgBonus − Σ dmgReduction)        ← [?] 分區組合待驗證
S7  屬性克制     x ×= (克制 ? 1.3 : 1.0)                       ← [V]
S8  暴擊         critRate_eff = critTech/30 + Σ critRate − target.critResist
                 擲骰（rng.crit 流）；命中則 x ×= critMultiplier
                 [?] critMultiplier = (critDmg − target.critDef) 還是 critDmg × (1 − critDef)
S9  受方修正     x ×= (1 + Σ vulnerable)；套用護盾吸收
S10 取整         [?] roundingRule（每步取整 vs 末端取整；捨去 vs 四捨五入）
S11 套用與事件   扣血、發 damage 事件（含 breakdown）、觸發受擊／擊殺時機窗
```

**多段攻擊（hits > 1）**：每一 hit 各自跑一次 S8～S11（暴擊各自判定），但 S1～S7 的面板快照**在第一 hit 前凍結**還是每 hit 重算？**[?]** 這會影響「打到一半觸發加攻」的結果，列入 §18-E7。

**治療與護盾**走同一套骨架但不同段組合（無防禦、無克制、有 healBonus、有 `Nasty Wound` 這類受治療減益），共用 `pipeline.js` 的 stage 機制，不要另外複製一份。

---

## 7. 效果系統

### 7.1 狀態定義

```js
{
  id: 'nasty_wound',
  name: { zh: '劇烈傷口', en: 'Nasty Wound' },
  polarity: 'debuff',
  stack:    { rule: 'stack', max: 99 },
      // rule: 'stack' 疊層 | 'refresh' 刷新時間 | 'overwriteStronger' 依強度與時間覆蓋（已查證是預設） | 'independent' 各自獨立
  duration: { unit: 'round', value: 3, tickAt: 'round.end' },
  dispellable: false,
  tags: ['undispellable', 'dot'],
  modifiers: [ { bucket: 'healBonus', value: -0.10, scope: 'self' } ],
  hooks: {
    'round.end': [ { op: 'damage', dmgType: 'genesis', target: 'self',
                     amount: { expr: 'applier.atk * 0.30 * stacks' }, tag: 'dot' } ]
  }
}
```

### 7.2 時機窗（引擎與資料之間的契約）

固定一份清單，資料只能掛在這些點上。新增時機窗要改引擎版本號。

```
battle.start / wave.start / wave.clear / battle.end
round.start / round.end
player.turn.start / player.turn.end / enemy.turn.start / enemy.turn.end
card.drawn / card.played / card.merged / card.moved / card.discarded
before.action.cost        ← Empower Incantation 這類「改 AP 成本」掛這裡
moxie.changed / ultimate.cast
before.damage.dealt / after.damage.dealt
before.damage.taken / after.damage.taken
before.heal / after.heal
shield.broken
status.applied / status.removed / status.resisted
unit.death / unit.kill / unit.revive
```

### 7.3 決定性排序（必做，最容易出事的地方）

同一個時機窗上可能有多個監聽器。排序鍵**固定**為：

```
(priority ASC, side: ally→enemy, unitIndex ASC, appliedSeq ASC)
```

- 絕對不能只靠陣列或 Map 的插入順序——那會隨著實作細節漂移，導致「同 seed 不同結果」。
- `appliedSeq` 來自全域 `state.seq`，狀態掛上去時就固定。
- 這條規則要有專門的測試：打亂施加順序後結果必須一致或以定義好的方式不同。

### 7.4 重入防護

- 每條效果鏈帶 `depth`，`Ricochet` 這類反傷產生的傷害 `depth + 1`。
- 同一個效果在同一條鏈上不得觸發兩次（除非資料明確標 `reentrant: true`）。
- 超過上限發 `engine.overflow`，dev 模式直接 throw，正式模式中止該鏈繼續跑。

---

## 8. 技能 DSL

### 為什麼要 DSL 而不是每個角色寫一個 JS 函式

130+ 角色 × 2 法術 × 3 卡等 + 大招 + 被動 ≈ **1000+ 份效果腳本**。如果全是手寫 JS：不能驗證、不能靜態分析、不能自動產生技能說明文字、每次改引擎要掃一遍全部。DSL 讓資料**可驗證、可查詢、可渲染**。

### 但一定要有逃生門

約 10% 的角色技能會有 DSL 表達不了的怪機制（改變牌庫、改寫回合流程、召喚物、條件分支很深）。這些允許：

```js
{ op: 'script', ref: 'lilya.ult.phase2' }   // 對應 js/r1999/engine/scripts/lilya.js 註冊的函式
```

**規則：逃生門的函式必須也是純函式（state, ctx) => ops[]，不得直接改 state。** 這樣決定性與可重播不會被破壞。逃生門用量要在 CI 統計，超過 15% 表示 DSL 設計失敗，要回頭補 op。

### 核心 op 清單（第一版）

```
damage      { dmgType, target, mult|amount, hits, tag, canCrit }
heal        { target, amount, canCrit }
shield      { target, amount, duration }
status      { apply|remove|dispel, id, target, stacks, duration }
moxie       { target, delta }
ap          { delta }                     // 改本回合 AP
card        { draw|discard|upgrade|generate|lock, ... }
tuning      { delta }
stat        { bucket, value, target, duration }   // 臨時面板修正
summon      { enemyRefId|allyRefId, ... }
if          { cond: <expr>, then: ops[], else: ops[] }
forEach     { over: 'enemies'|'allies'|'statuses', as: 'u', do: ops[] }
script      { ref }
```

### 表達式

小型安全求值器，**不准用 `eval` / `new Function`**（本站是純靜態頁面，沒有 CSP 也不該開這個口）。支援：

- 變數：`self.atk`、`target.hp%`、`caster.moxie`、`stacks`、`round`、`enemies.count`
- 運算：`+ - * / min max floor ceil clamp`
- 條件：`> < >= <= == && || !`、`target.hasStatus('burn')`

實作方式：Pratt parser + AST 直譯，約 200 行。編譯結果快取在資料載入時。

### 目標選擇器

```
enemy.single / enemy.all / enemy.random(n) / enemy.lowestHp / enemy.highestAtk
ally.single / ally.all / ally.lowestHpPct / ally.self / ally.caster
```

隨機選擇一律走 `rng.misc` 流，並把選中結果寫進事件，重播才能對得上。

---

## 9. 敵人與關卡

```js
// enemies.js
{ id: 'boss_xxx', name: {...}, afflatus: 'beast',
  stats: { hp, atk, defReality, defMental, critTech, critResistTech },
  resist: { reality: 0.2, mental: 0, genesis: 0 },   // [?] 是否有此欄位待驗證
  skills: [...],
  ai: {
    // 依序比對，第一個成立的 rule 生效
    rules: [
      { when: 'self.hp% < 0.5 && !self.hasStatus("phase2")',
        do: [{ op:'status', apply:'phase2', target:'self' }, { op:'cast', skill:'rage' }] },
      { when: 'round % 3 == 0', do: [{ op:'cast', skill:'aoe' }] },
      { weight: 3, do: [{ op:'cast', skill:'basic', target: 'ally.random' }] },
      { weight: 1, do: [{ op:'cast', skill:'debuff', target: 'ally.highestAtk' }] }
    ],
    targeting: { default: 'ally.random', respectTaunt: true }   // [?] 真實目標規則待驗證
  }
}

// stages.js
{ id: 'story_9_15', name: {...},
  waves: [ { enemies: [{ refId, level, slot: 0 }, …] } ],
  rules: { apOverride: null, onFieldMax: 3, roundLimit: null,
           victory: 'clearAll' | 'survive(n)' | 'protect(uid)',
           modifiers: [ /* 關卡特殊規則，用同一套 DSL */ ] }
}
```

敵方 AI 的目標選擇規則是**校準優先項**：如果 AI 打錯人，整場模擬的存活判定就沒有意義。M5 要用真機錄影統計目標分布（§18-E9）。

---

## 10. 決定性、重播與存檔

### 亂數

`xoshiro128**`（32-bit，快、週期夠、易在 JS 精確實作），**多流**：

```js
rng.stream('draw')  // 抽牌
rng.stream('crit')  // 暴擊判定
rng.stream('ai')    // 敵方行為
rng.stream('misc')  // 隨機目標、機率型效果
```

分流的理由：如果共用一條流，多擲一次暴擊骰就會讓後面的抽牌全部位移，導致「改一行程式，所有黃金測試全紅」，根本沒辦法維護。

### 重播格式

```json
{
  "schema": 1,
  "dataVersion": "2026.08-a",
  "engineVersion": "0.4.2",
  "seed": "0x9e3779b97f4a7c15",
  "stage": "story_9_15",
  "loadout": {
    "field": [ { "refId": "lilya", "insight": 3, "lv": 60,
                 "resonance": {...}, "psychube": { "id": "...", "portray": 4 },
                 "euphoria": { "unlocked": true } } ],
    "bench": [ ... ]
  },
  "actions": [ { "r": 1, "type": "play", "cid": "c3", "targetUid": "e0" }, … ],
  "checksum": "sha256:…"    // 對 event log 的指紋，重播時比對
}
```

- `checksum` 讓「重播不一致」變成**立刻可偵測**而不是靜默漂移。
- `dataVersion` 或 `engineVersion` 不符時，UI 明確警告「此重播來自舊版本，結果可能不同」，不要假裝沒事。

---

## 11. 需要哪些資料（來源盤點與缺口）

### 11.1 現況：**戰鬥數值沒有現成的結構化來源**

實測結果（本工單撰寫時逐一探測）：

| 來源 | 可取得 | 有什麼 | 缺什麼 |
|---|---|---|---|
| `windbow27/kornblume`（GitHub raw 可直連） | ✅ `public/data/arcanists.json`（133 筆，含 129 已實裝）、`psychubes.json`（37 筆）、`stages.json`（100 筆） | 角色**面板斷點**（`0-1/0-30/1-40/2-50/3-60`，7 項數值）、洞悉／共鳴／狂歡／專精的**材料消耗**、關卡掉落率 | **完全沒有技能倍率、沒有效果文字、沒有狀態定義、沒有敵人數值**；`psychubes.json` 只有名稱與敘述，**沒有面板也沒有被動效果** |
| Fandom 英文 wiki `reverse1999.fandom.com` | ⚠️ 本環境 egress 擋掉，一般網路可讀 | 傷害公式、狀態說明、角色技能文字 | 非結構化，要自己 parse；CC-BY-SA 需標註 |
| 灰機 wiki `res1999.huijiwiki.com` | ⚠️ 本環境擋掉 | 中文技能文字、數值表，通常最完整 | 同上 |
| `myssal/Reverse-1999-CN-Asset`、`Escartem/Reverse1999Dump` | ✅ GitHub raw 可直連 | 遊戲**美術／音訊資產** dump | 不含數值表 |
| `kiraio-moe/Reverse1999-Anarchist` | ✅ | 資產加解密工具 | 工具而非資料 |
| `gululu1235/Reverse1999Simulator` | ✅ | **既有戰鬥模擬器實作**（Python，事件驅動；含少數角色的技能實作） | 角色覆蓋少；可當規則對照組，不可當資料來源 |

**結論：技能倍率與狀態定義必須自己建。** 三條路，建議並行：

1. **wiki 抓取 + 人工校對**（主路）：`tools/build-r1999-data.py` 抓 wiki 技能頁 → 正則抽數字 → 產出草稿 → **人工逐條校對**。估：一個角色（2 法術 ×3 卡等 + 大招 + 被動）約 20～40 分鐘，129 角色 ≈ **45～85 人時**。
2. **遊戲內截圖 + 人工錄入**（補洞）：wiki 落後或缺漏時用。本 repo 已有截圖辨識的前例（`tools/build-card-sigs.py`、站內截圖辨識功能），可沿用同一套流程。
3. **資產 dump 反查**（進階）：若 dump 內含設定表（需確認），可直接得到權威數值。**先花半天確認可行性再投入**，不確認就別排進關鍵路徑。

### 11.2 必要資料清單

| # | 資料 | 筆數量級 | 來源 | 阻擋度 |
|---|---|---|---|---|
| D1 | 角色面板斷點（攻／生／現防／精防／暴技／暴率／抗暴） | 129 | Kornblume ✅ **已可取得** | 低 |
| D2 | 角色屬性、稀有度、傷害類型、定位 | 129 | Kornblume ✅ | 低 |
| D3 | **法術／大招：每卡等的倍率、命中數、效果、標籤** | ~1000 條 | wiki + 人工 | **🔴 最高，是關鍵路徑** |
| D4 | **狀態效果定義**（疊加、時長、驅散、掛鉤時機） | 100～200 | wiki + 遊戲內實測 | **🔴 高** |
| D5 | 被動技能（洞悉解鎖） | ~390 | wiki + 人工 | 高 |
| D6 | 共鳴數值表（等級 2～15 × 形狀） | 中 | wiki | 中 |
| D7 | 心相面板 + 塑造 1～5 的被動 | 37+ × 5 | wiki | 中 |
| D8 | 狂歡：面板、被動、Epiphany、法術節奏規則 | 逐步擴充 | wiki | 中 |
| D9 | 敵人數值與技能 | 數百 | 遊戲內實測為主 | 高 |
| D10 | 關卡波次與特殊規則 | 依範圍 | 遊戲內 | 中 |
| D11 | **校準用黃金重播**（真機錄影逐回合抄錄） | 30～50 場 | 自己錄 | **🔴 高，但不做就無法宣稱正確** |
| D12 | 常數表（克制 1.3、暴率 ÷30、AP 規則、手牌公式…） | 一頁 | §2 已查證大半 | 低 |

### 11.3 資料品質規範

- 每一筆資料帶 `source`（URL 或「遊戲內 v3.x 截圖」）與 `verifiedAt`，**沒有出處的數字不准進 repo**。
- 未驗證的欄位用 `null` 而不是猜一個值；引擎遇到 `null` 要明確報「資料缺漏」而不是當 0 算下去。
- `tools/verify-r1999-data.py` 在 CI 檢查：schema、引用完整性（技能引用的狀態存在）、數值合理範圍、缺漏統計報表。

---

## 12. 需要哪些素材

**前提**：官方美術是 Bluepoch 的著作財產，本站不打包（§17）。素材策略分兩軌：

### 軌 A：自製／佔位（預設，M1～M5 全程用這套）

| 素材 | 規格 | 做法 |
|---|---|---|
| 屬性圖示 ×6 | SVG，24/32/48px | 自製幾何符號，不描摹官方圖 |
| 卡牌框 1/2/3 級 | CSS 漸層 + border | 純 CSS，零檔案 |
| 角色頭像佔位 | 64×64 | 由角色 id 生成的確定性色塊 + 首字 |
| 狀態圖示 | SVG 24px，~40 個 | 依「增益／減益 × 類別」做一組符號系統，同類共用 |
| 傷害飄字、血條、Moxie 星 | CSS/SVG | 自製 |
| 字型 | 系統字堆疊 | 不引入遊戲字型 |

### 軌 B：使用者自備（可選，M6 之後再議）

若要顯示官方立繪：做成**本機載入**（使用者自己指定資料夾／貼圖），不放進 repo、不放進 CDN。

### 音效／BGM

**不做。** 授權風險與收益完全不成比例；戰鬥模擬器的價值在數字不在氣氛。

### 尺寸與效能預算

- 單張圖 ≤ 40KB（webp），總素材 ≤ 1.5MB。
- 首屏（引擎 + UI + 一個關卡的資料）≤ 400KB gzip。角色資料按需 lazy load。

---

## 13. 資料管線與建置

```
                 ┌──────────────┐
 GitHub raw ────▶│              │
 wiki 抓取   ───▶│ build-r1999- │──▶ build/r1999/*.raw.json ──▶ 人工校對 ──┐
 人工 CSV    ───▶│ data.py      │                                          │
                 └──────────────┘                                          ▼
                                                              ┌────────────────────┐
                                                              │ verify-r1999-      │
                                                              │ data.py（CI 擋門） │
                                                              └─────────┬──────────┘
                                                                        ▼
                                                              data/r1999/*.js
                                                                        ▼
                                                        tools/stamp-assets.py
```

規則：

- **原始抓取結果（`build/`）不進 repo**，只進 `data/r1999/`（正規化後）。
- 人工校對的修正寫在 `data/r1999/overrides/*.js`，**抓取時不覆蓋**——這樣重抓不會把人工成果洗掉。這條跟 repo 既有的 `data/history/` 只增不改的精神一致。
- `verify` 失敗就 CI 紅燈，不准合併。

---

## 14. UI

單頁 `r1999.html`，四個區塊：

1. **編成**：選角色（4 位 + 場上/後備）、洞悉、等級、共鳴、心相與塑造、狂歡；可存成 preset（localStorage）。
2. **戰場**：敵我單位、血條、Moxie、狀態圖示（hover 出完整說明與剩餘回合）、敵方行動預告。
3. **手牌**：拖曳出牌／拖曳合成／拖曳移動，顯示 AP 與調率條。三種操作都耗 AP，UI 要**在拖曳時就預示成本**，不然玩家會誤操作。
4. **日誌／明細**：event log 可展開每一次傷害的 `breakdown`（S1～S10 每段的中間值）。**這是模擬器相對真機的最大賣點，優先度高於動畫。**

附加模式：

- **批次模擬**：設定次數與策略，輸出傷害分布直方圖、通關率、平均回合數。走 Worker，不卡 UI。
- **重播**：貼上重播 JSON 逐步播放，可單步、可跳回合。

無障礙與行動裝置：拖曳要有「點選來源 → 點選目標」的替代操作；戰場在窄螢幕改為直向堆疊。

---

## 15. 測試與校準

| 層級 | 內容 | 擋門 |
|---|---|---|
| T1 單元 | 管線每一段、分區合併、狀態疊加、抽牌上限、AP 計算 | CI |
| T2 決定性 | 同 seed 跑兩次，event log 逐項相同；打亂效果施加順序後結果符合 §7.3 的定義 | CI |
| T3 不變量（property-based） | HP 不為負且不超上限、AP 不超發、Moxie ≤ 5、手牌 ≤ 上限、事件 seq 單調遞增、重播 checksum 相符 | CI |
| T4 **黃金重播** | 30～50 場真機錄影逐回合抄錄，比對**每一次傷害數字** | CI |
| T5 資料驗證 | schema、引用完整性、缺漏報表 | CI |
| T6 效能 | 10,000 場批次 < 10 秒（單執行緒），單場 < 1ms | 每次發版 |
| T7 模糊測試 | 隨機操作 100 萬步不得 throw、不得 overflow | 每次發版 |

### 校準流程（T4 的實際做法）

1. 錄一場真機（含傷害數字、狀態圖示、AP、手牌）。
2. 逐回合抄成重播 JSON（`tools/r1999-calibrate.py` 提供半自動的抄錄格式）。
3. 跑模擬器，輸出對照表：`回合 / 動作 / 期望傷害 / 實際傷害 / 誤差 / breakdown`。
4. 誤差非零 → 從 breakdown 反推是哪一段錯 → 改分區或取整規則 → **全部黃金重播重跑**（避免修 A 壞 B）。

**驗收門檻**：黃金集合中 ≥ 95% 的傷害事件誤差為 0，其餘誤差 ≤ 1 且能解釋成取整。

---

## 16. 效能預算

| 項目 | 預算 |
|---|---|
| 單場戰鬥（20 回合） | < 1 ms |
| 10,000 場批次（Worker） | < 10 s |
| 首屏資源 | < 400 KB gzip |
| UI 每幀 | < 8 ms（不含動畫） |
| 記憶體（批次中） | < 200 MB |

達成手段：state 用平坦物件不用 class 繼承；批次模擬關掉 event log（`options.log = false`）；面板 memo 以 statuses 指紋為 key；Worker 池 = `navigator.hardwareConcurrency − 1`。

---

## 17. 授權、合規與風險

### 合規

- 這是**非官方、非營利**的粉絲工具。頁面顯著標註：與 Bluepoch 無關，遊戲名稱與素材著作權屬原公司。
- **不打包官方美術／音訊／字型**（§12）。
- 數值資料屬事實性資料，風險較低，但**引用 wiki 需依其授權標註**（Fandom 為 CC-BY-SA）。抓取要遵守 robots.txt 與合理速率（建議 ≥ 1 req/s、帶 User-Agent 與聯絡方式）。
- 收到官方或 wiki 方的異議即下架相關資料，**這條要事先寫進 README，不是出事再想**。

### 風險

| 風險 | 影響 | 對策 |
|---|---|---|
| **技能資料錄入量被低估** | 進度延誤數週 | M0 先做 5 個角色量測實際單耗，再據以重估；先做熱門角色，覆蓋率當成持續指標而非里程碑 |
| **公式細節反推不出來** | 忠實度達不到 | 分區設計（§6）讓組合方式可調；實在推不出的段落標成「近似」並在 UI 明示 |
| **遊戲版本更新改機制** | 資料與引擎同時過期 | `dataVersion` + 黃金重播回歸；每次改版跑一次全量校準 |
| **狂歡／法術節奏改動出牌流程** | 架構重做 | **M0 就要釐清**（§2.9），列為 M1 前置阻擋條件 |
| **範圍蔓延**（做成完整遊戲） | 永遠做不完 | §1 非目標寫死；任何新需求先問「這對 G1 忠實度有幫助嗎」 |
| **egress 限制**（本開發環境） | 抓不到 wiki | 資料抓取在本機或 CI 執行，不依賴 agent 環境；GitHub raw 已確認可直連 |

---

## 18. 待驗證清單（實驗設計）

每項給：假設 → 實驗方法 → 判定。**這份清單跑完之前，模擬器不得宣稱「準確」。**

| # | 問題 | 實驗方法 | 產出 |
|---|---|---|---|
| E1 | 取整位置與方式 | 找一個無暴擊、無增益的乾淨場景，用已知面板反推理論值，比對真機顯示數字；再引入一個小數增益重複 | `roundingRule` 常數 |
| E2 | 增傷與減傷是否同一加法區 | 找兩個獨立增傷來源同時掛上，比較 `1+a+b` 與 `(1+a)(1+b)` | `dmgBonus` / `dmgReduction` 的 combine |
| E3 | 減防多來源疊加方式 | 兩個減防來源同時掛上，同上比法 | `defDown` 的 combine |
| E4 | `ATK − DEF ≤ 0` 的下限 | 用低攻角色打高防敵人 | `floorRule` |
| E5 | 暴擊傷害與暴擊防禦的關係 | 對有／無暴防的目標各打 50 次暴擊 | `critMultiplier` 公式 |
| E6 | 面板斷點之間是否線性 | 記錄 41、45、49 級的面板，與 `1-40`／`2-50` 內插比對 | 內插規則 |
| E7 | 多段攻擊是否每 hit 重算面板 | 用「打擊時疊加攻擊力」的效果搭配多段技能 | 多段快照策略 |
| E8 | 抽牌權重與保底 | 固定隊伍空過 200 回合，統計各牌出現頻率與連續同牌分布 | 抽牌模型 |
| E9 | 敵方目標選擇規則 | 固定隊伍打同一關 30 次，統計挨打分布（是否偏低血／前排／嘲諷） | AI targeting 模型 |
| E10 | 調率條累積規則 | 逐回合記錄調率條，分別測「不出牌」「出滿 3 張」 | 調率模型 |
| E11 | 移動卡片給 Moxie 的條件 | 移動到不同位置／移回原位／移動大招牌，各記錄 Moxie | Moxie 規則 |
| E12 | 大招施放後的 Moxie 結算 | 滿 5 Moxie 放大招後看剩餘 | Moxie 規則 |
| E13 | 死亡佔用手牌格的細節 | 讓一名角色死亡且無替補，數手牌上限 | 手牌公式 |
| E14 | 同名狀態覆蓋的判定順序 | 先掛長時間弱效果，再掛短時間強效果，反之亦然 | `overwriteStronger` 定義 |
| E15 | 狂歡的法術節奏對出牌的具體改動 | 對比同角色狂歡前後的抽牌與卡等表現 | 是否需要擴充卡牌模型 |

**建議**：E1～E5 是傷害管線的地基，排在 M2 之前；E8～E9 排在 M3／M5 之前；其餘可平行。

---

## 19. 里程碑與子工單

依賴關係：`M0 → M1 → M2 → M3 → {M4, M5} → M6`。

### M0 探勘與規則凍結（3～5 天）

| 子工單 | 內容 | 驗收 |
|---|---|---|
| S0.1 | 跑完 E1～E5 實驗，產出常數表 | `data/r1999/meta.js` 有值且每項附實驗記錄 |
| S0.2 | 釐清狂歡／法術節奏是否改動出牌流程（E15） | 一頁結論，明確回答「卡牌模型要不要擴充」 |
| S0.3 | 讀 `gululu1235/Reverse1999Simulator` 的狀態機，對照 §5 補漏 | 差異清單 |
| S0.4 | 5 個角色的技能資料試錄，量測單耗 | 實測人時 → 重估 D3/D5 工期 |
| S0.5 | 確認資產 dump 是否含設定表 | 可行／不可行的結論，不可行就結案不再投入 |

### M1 引擎骨架（1.5 週）

| 子工單 | 內容 | 驗收 |
|---|---|---|
| S1.1 | `rng.js` 多流決定性亂數 | 已知 seed 產生的序列有測試向量 |
| S1.2 | `state.js` + `reducer.js` 骨架 | `apply` 純函式，state 可 structuredClone |
| S1.3 | `flow.js` 回合狀態機（§5） | 相位轉換測試全綠 |
| S1.4 | 事件系統與 log 格式 | 事件 schema 有測試 |
| S1.5 | 重播格式 + checksum | 同 seed 兩次跑出相同 checksum |

### M2 傷害管線與校準（2 週）

| S2.1 | `buckets.js` + `pipeline.js` S1～S11 | 每段有單元測試，`breakdown` 欄位齊全 |
| S2.2 | 屬性克制、傷害類型、暴擊 | 對照 E1～E5 的常數 |
| S2.3 | 治療／護盾 | 同管線骨架 |
| S2.4 | 首批 5 場黃金重播 | 傷害誤差 0 的比例 ≥ 95% |

### M3 出牌流程（1.5 週）

| S3.1 | 牌庫、抽牌、手牌上限（含死亡佔位） | E8/E13 的模型有測試 |
| S3.2 | 合成、移動、AP 扣除、Moxie | E11/E12 的規則有測試 |
| S3.3 | 大招生成（下回合開始）與施放 | 時序測試 |
| S3.4 | 調率條與兩個調率技能 | E10 的模型有測試 |

### M4 效果系統與角色資料（2 週 + 持續）

| S4.1 | 狀態註冊表、時機窗、優先序、重入防護 | §7.3 排序測試、overflow 測試 |
| S4.2 | DSL 直譯器 + 表達式求值器（不用 eval） | op 覆蓋測試 |
| S4.3 | 逃生門 `script` 機制 + 統計 | 用量在 CI 有報表 |
| S4.4 | 前 20 名常用角色完整資料 | 每角色至少一場黃金重播通過 |

### M5 敵人與關卡（1.5 週）

| S5.1 | 敵人模型與 AI 腳本直譯器 | 規則優先序測試 |
| S5.2 | E9 目標分布校準 | 模擬分布與實測分布的卡方檢定不顯著 |
| S5.3 | 關卡波次、勝負條件、關卡修正 | 3 個真實關卡可完整跑通 |

### M6 UI 與批次模擬（2 週）

| S6.1 | 編成、戰場、手牌拖曳、日誌 | 行動裝置可用；有非拖曳替代操作 |
| S6.2 | `breakdown` 展開面板 | 每次傷害都能展開到 S1～S10 |
| S6.3 | Worker 批次模擬 + 統計圖 | 10,000 場 < 10 s |
| S6.4 | 重播載入／分享 | 版本不符時明確警告 |

### M7 資料擴充（持續）

角色覆蓋率當**指標**（每週回報），不當里程碑。每新增 10 個角色跑一次全量黃金重播回歸。

---

## 20. 驗收標準（DoD）

一個功能算「完成」必須同時滿足：

1. ✅ 黃金重播中相關場景全數通過（傷害誤差 0 的比例 ≥ 95%，其餘 ≤ 1 且能解釋）。
2. ✅ 決定性測試通過（同 seed 兩次 → 相同 checksum）。
3. ✅ 不變量測試通過（HP／AP／Moxie／手牌上限）。
4. ✅ 涉及的資料都有 `source` 與 `verifiedAt`；無 `null` 殘留在已宣告支援的角色上。
5. ✅ `tools/verify-r1999-data.py` 綠燈。
6. ✅ 效能預算未回退（§16）。
7. ✅ 提交前跑過 `python3 tools/stamp-assets.py`。
8. ✅ 未驗證的機制在 UI 上明確標示為「近似」，不假裝精確。

---

## 21. 參考來源

機制查證（2026-08 撰寫時）：

- Reverse: 1999 Wiki (Fandom) — [Damage](https://reverse1999.fandom.com/wiki/Damage)、[Critical Rate](https://reverse1999.fandom.com/wiki/Critical_Rate)、[Moxie](https://reverse1999.fandom.com/wiki/Moxie)、[Tips](https://reverse1999.fandom.com/wiki/Tips)
- [Damage Calculation in Reverse: 1999 — DotGG](https://dotgg.gg/reverse-1999/damage-calculation-in-reverse-1999/)
- [Beginner Guide — Prydwen Institute](https://www.prydwen.gg/re1999/guides/beginner-guide)、[Introduction to the game](https://www.prydwen.gg/re1999/guides/introduction-to-the-game)
- [Reverse: 1999 — Combat Mechanics Guide (gameplay.tips)](https://gameplay.tips/guides/reverse-1999-combat-mechanics-guide.html)
- [Afflatus Type Guide — Attack of the Fanboy](https://attackofthefanboy.com/guides/reverse-1999-afflatus-type-guide-all-weaknesses-and-resistances/)
- [Afflatus 戰鬥輪 — HostedGG](https://hostedgg.com/blog/reverse-1999-afflatus-combat-guide)
- [Tuning Guide — Gamezebo](https://www.gamezebo.com/walkthroughs/reverse-1999-tuning/)
- [Euphoria & Reveries in the Rain — Prydwen Blog](https://blog.prydwen.gg/2025/02/23/reverse-1999-euphoria-reveries-in-the-rain-explained/)
- [Effects — Reverse:1999 Gnomon](https://reverse1999-gnomon.pages.dev/effects)

資料與程式碼來源：

- [windbow27/kornblume](https://github.com/windbow27/kornblume) — 養成向資料（本工單已實測 `public/data/arcanists.json`、`psychubes.json`、`stages.json` 的實際結構）
- [gululu1235/Reverse1999Simulator](https://github.com/gululu1235/Reverse1999Simulator) — 既有戰鬥模擬器（Python，事件驅動狀態機 + RL 環境）
- [myssal/Reverse-1999-CN-Asset](https://github.com/myssal/Reverse-1999-CN-Asset)、[Escartem/Reverse1999Dump](https://github.com/Escartem/Reverse1999Dump) — 資產 dump
- [kiraio-moe/Reverse1999-Anarchist](https://github.com/kiraio-moe/Reverse1999-Anarchist) — 資產加解密工具

> 標 **[?]** 的項目**尚未查證**，一律以 §18 的遊戲內實驗為準。網路上的公式整理彼此矛盾且多半沒寫取整與分區，不可直接當規格用。
