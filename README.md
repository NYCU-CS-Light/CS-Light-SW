# Led Sequence

## 匯入音檔
- 在音軌那邊按 `+ Import` 的按鈕

## 匯入 ball sequence
- 在 `BALLS` 區塊按 `＋ Add`，可以選 `Add empty ball` 或 `Import two .txt files`
- 匯入時請選兩個 firmware 文字檔，通常是 `led0.txt` / `led1.txt`

## 工具列
右上角的四個按鈕，括號內是鍵盤切換鍵：

- **Paint** (`P`) ✏：在 track 上點/拖來新增 led，內容取決於你選的 `color`、`blink`…
- **Select** (`S`) ▢：選 led；track 內可以拉框做範圍匡選
- **Erase** (`E`) ⌫：點 led 刪掉
- **Snap** ⊞：on 的時候 add 和拖移都會 align bpm，off 的時候可以自由移動

不同工具現在會有不同的 cursor，方便判斷目前在哪個模式。

## Paint 模式的隱藏招式

不需要切換工具就可以即時做這些事：

- **按住 `Ctrl` / `Cmd`** → 暫時變成 Select：在空 grid 上拖框 = 範圍選取、`Ctrl`-點 clip = 加入 / 移出多選。Cursor 也會跟著變成 select 的樣子。
- **按住右鍵** → 變成 brush-erase：cursor 立刻變成刪除圖示，按住右鍵在 timeline 上滑過去，經過的 clip 都會被刪掉。整段 sweep 算一次 `Ctrl+Z` 可還原。

## 選取

- `Ctrl+A` / `Cmd+A`：全選所有 note
- 平常點 clip：單選
- `Ctrl` / `Cmd`-點 clip：toggle 進 / 出多選
- 拉框：覆蓋掉舊選取
- 按住 `Ctrl` / `Cmd` / `Shift` 再拉框：把框內的併進原本的選取
- `Esc`：清空選取

選好之後：

- 抓任一個被選中的 clip 拖移 → 所有被選的 clip 一起平移（含跨 track / 跨 ball）
- 抓任一個被選中的 clip 的**右邊緣**拖 → 所有被選的 clip 一起調長度

## 編輯 / 復原

- 加 / 刪 / 拖 / 改長度 / 貼上 / Import / New project / Add ball / Remove ball / 改 BPM 全部都可以 undo
- `Ctrl+Z` / `Cmd+Z`：undo
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` 或 `Ctrl+Y`：redo
- 在文字欄位內（BPM、專案名）按 `Ctrl+Z` 走的是瀏覽器原生 undo，不會踩到 app 的 undo stack

## 改顏色

- 按 `` ` `` → 在 `Palette` 選 `custom`

## 專案命名

- 左上角 `LIGHTSEQ` 下方有可編輯欄位
- 名稱會存進 `.lbproj`、也會當成下載檔名（特殊字元自動換成 `_`）
- 按 `Enter` 或 `Esc` 結束編輯；留空會回 `Untitled`

## 匯出

- 右上角 `file` 選 `Export sequence .zip`（餵給韌體用的）
- `Export .lbproj`：存可以再開的專案檔
- `Import .lbproj`：載入之前存的專案

## 鍵盤快速鍵總覽

| Key | 動作 |
| --- | --- |
| `Space` | 播 / 停 |
| `P` / `S` / `E` | 切到 Paint / Select / Erase |
| `1`–`8` | 切換色號 |
| `` ` `` | 開 / 關 Tweaks 面板 |
| `Ctrl+A` | 全選 |
| `Esc` | 清空選取 |
| `Delete` / `Backspace` | 刪掉選取的 note |
| `Ctrl+C` / `Ctrl+V` | 複製 / 貼上 |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo |
| `Ctrl + 滾輪` | 在 timeline 上 zoom |
