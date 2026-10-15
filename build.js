// Run: node build.js
// Reads every notes/*.md and writes notes-data.js (loaded by index.html).
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'notes');
const notes = fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => {
  let raw = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\r\n/g, '\n');
  const meta = { date: fs.statSync(path.join(dir, f)).mtime.toISOString().slice(0, 10), pinned: false };
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (m) {
    raw = raw.slice(m[0].length);
    m[1].split('\n').forEach(l => {
      const [k, ...v] = l.split(':'); const val = v.join(':').trim();
      if (k.trim() === 'date') meta.date = val;
      if (k.trim() === 'pinned') meta.pinned = val === 'true';
    });
  }
  return { id: 'file:' + f.replace(/\.md$/, ''), date: meta.date, pinned: meta.pinned, md: raw.trim() };
});
fs.writeFileSync(path.join(__dirname, 'notes-data.js'), 'window.NOTES_DATA = ' + JSON.stringify(notes, null, 1) + ';\n');
console.log(`Built ${notes.length} notes → notes-data.js`);
