import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
const assets = {};
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
for (const file of await readdir('.')) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!mime[ext]) continue;
  let bytes = await readFile(file);
  if (file === 'index.html') bytes = Buffer.from(bytes.toString().replace('<script type="module" src="app.js">', '<script>window.BREAD_CLOUD = true;</script><script src="cloud-sync.js"></script><script type="module" src="app.js">'));
  assets['/' + file] = { type: mime[ext], data: bytes.toString('base64') };
}
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await writeFile('dist/server/assets.js', 'export default ' + JSON.stringify(assets) + ';\n');
await cp('server/worker.mjs', 'dist/server/index.js');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', {recursive: true});
console.log('Built private bakery workspace.');
