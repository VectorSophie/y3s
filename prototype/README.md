# y3s demo (prototype)

A throwaway prototype of the new y3s direction: tools that sit inside YouTube's
own page and look like YouTube made them. Nothing is saved to your account;
every change only affects the page you're on. Reload and it's all back.

## Install

1. Unzip this folder.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. If the old y3s extension is loaded, turn it off.
4. **Load unpacked** → pick this folder.
5. Open any playlist (`youtube.com/playlist?list=…`) or play a video from one.

## Try on a playlist page

- Type in **Filter this playlist** (or press `/`).
- Chips: **Duplicates**, **Unavailable**, and **Sort** (title, channel, length,
  reverse, shuffle). With Duplicates on, try **Remove extra copies**.
- Hover a row → checkbox. Shift-click for a range. The bar turns into
  **N selected · Play · Move to top · Move to bottom · Remove**.
- Every edit shows a bottom-left message with **Undo**.
- Keyboard: `j`/`k` move, `x` select, `Shift+j/k` extend, `Enter` play,
  `t`/`b` move selection to top/bottom, `Delete` remove, `z` undo, `?` help.
- **Load all** pulls in the rest of a long playlist so the filter covers it.
- **Play** on a selection opens it as a temporary queue (first 50).

## Try on a watch page

With a playlist playing, the side panel gets a filter field (Enter plays the
first match) and a **Jump to now playing** button.
