# CS-Light-SW

## Setup
### Frontend
```shell
cd frontend/cs_light_frontend
npm install
npm run dev
```

### Backend
```shell
cd backend
uv sync
uv run dev_server.py
```

## Features
### Current Features
1. 讀取音檔並顯示成波形圖
2. 有 `+`, `-` button 來控制波形圖縮放

### TODO
- 讀取音檔並顯示節奏
- 可以透過輸入時間或是拖曳框框來決定一個 isa 的時間段 (以及相關的一些參數)
