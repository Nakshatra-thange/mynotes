# Notes

An Apple Notes–style notes site / blog. No frameworks, no install.

## Run
```
node build.js          # turns notes/*.md into notes-data.js
npx serve .            # or just open index.html
```

## Add a note from code
Create `notes/anything.md`:
```
---
date: 2026-10-15
pinned: false
---
# Title
Your text, **bold**, *italic*, [links](https://…), ![img](images/pic.png)

- [ ] a to-do
- [x] a done to-do

| A | B |
|---|---|
| 1 | 2 |
```
then run `node build.js`. Put images in an `images/` folder.

## Add a note in the browser
Press **N** or click ✎. Paste/drag photos, add tables and checklists from the toolbar.
Browser notes are saved to this device (localStorage).

## Deploy
Upload the folder to GitHub Pages / Netlify / Vercel. Run `node build.js` first.
