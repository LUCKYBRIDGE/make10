# 10만들기

Standalone static prototype for a quiet scattered-number linking puzzle.

## Run

```sh
python3 -m http.server 4310 --bind 127.0.0.1
```

Open `http://127.0.0.1:4310/`.

## Verify

```sh
node --check app.js
```

## Prototype Rules

- Numbers are scattered at irregular positions instead of arranged in a grid.
- Larger boards show more numbers so multiple players have more separate targets.
- Screen modes are available for mobile, tablet, and web/electronic-board play.
- Each mode also adapts to compact, standard, wide, and large viewport sizes.
- Recommended play count is 1-6 players, with up to 10 simultaneous touch inputs on supported hardware.
- Drag across numbers to make a path.
- The selected path clears only when its sum is exactly 10.
- Only the user-selected path is judged; there is no automatic board-wide matching.
- Cleared numbers are immediately replaced with new random numbers.
- Score increases on each successful 10, with extra points for longer paths and higher combos.
- A wrong sum breaks the current combo.
- There is no timer, combat loop, ranking mode, or persistent record storage.
