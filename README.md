# CS-Light-SW
The software part of CS Light

# Proto
我想要寫一個程式，主要是根據音樂編排受某個 processor 控制的燈泡效果，所以需要將這樣的結果類似轉換成 ISA ，之後再根據 ISA 的定義輸出成 binary 執行檔，我現在想要進行的架構如下:

## 功能
1. 讀入音檔，並將其弄成波形圖
    - 可以讀取音檔，並將其切分成不同段落
    - 可以根據該段落音檔顯示音檔的節奏 (標註在波型上)
        - 這部分是因為這個音檔可能是透過不同段音樂合起來的，先進行切分應該可以再處理的時候更好的判斷音訊節奏
2. 決定 ISA 段落
    - 可以透過輸入時間或是拖曳框框來決定一個 isa 的時間段
    - 這個段落可以顯示成我指定後選擇的顏色
    - 同時也需要調整 ISA 的相關參數

## 前端 Vue.js
- 透過 wavesurfer.js 來進行音訊的相關操作

## 後端 Python (FastAPI)
- 後端版控 uv
- 透過 librosa 來偵測音訊節拍
    - beat_frames (回傳的第二個變數): 這是 「每個節拍的時間點」。這才是我要的東西

## Project structure
```
CS-Light-SW/
├── backend/                 # Python 環境 (uv 版控)
│   ├── main.py              # FastAPI 入口
│   ├── audio_processor.py   # Librosa 相關邏輯
│   ├── isa_compiler.py      # Struct/ISA 轉換邏輯
│   └── project.toml ...
├── frontend/cs_light_frontend            # Vue 環境 (Vite create)
│   ├── src/
│   │   ├── components/
│   │   │   ├── TimelineEditor.vue  # Wavesurfer 邏輯
│   │   │   ├── ParameterPanel.vue  # 參數調整表單
│   │   │   └── TopBar.vue          # 播放/暫停/匯出按鈕
│   │   ├── stores/
│   │   │   └── projectStore.js     # Pinia: 管理目前所有區塊資料
│   │   └── App.vue
│   ├── package.json
│   └── vite.config.js
└── output/              # 存放生成的 .bin 檔
```

cd cs_light_frontend
   npm install
   npm run format
   npm run dev