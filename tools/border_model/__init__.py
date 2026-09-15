"""榜線終線預測模型 M3（對數線性速率回歸 + 隨 τ 堆疊集成）的擬合端。

前端推論在 js/border-model.js，參數檔 data/border-model.json 由 tools/build-border-model.py
每日重擬。這個套件只用 numpy。

    data.py   讀 data/history/*.json 與 data/borders-db.js、fixMono、官方終線快取
    model.py  擬合（速率剖面、成員、堆疊、分位）與參考推論
"""
