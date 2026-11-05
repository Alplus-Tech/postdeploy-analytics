import { readFileSync, writeFileSync, lstatSync, existsSync, mkdirSync, statfsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function validatePath(path) {
  if (typeof path !== 'string' || !/^[a-zA-Z0-9_.\/-]+$/.test(path) || path.length > 99 || path.startsWith('/') || path.split('/').some(p => !p || p === '..' || p === '.')) throw Error('Unsafe release path');
  if (path.split('/').some(p => /^(?:\.git|\.agents|\.claude|\.scratch|\.wrangler|\.self-host|node_modules|backups|agents|AGENTS\.md|CLAUDE\.md)$/.test(p)) || /(?:\.sqlite|\.db|\.log|\.map)$/.test(path) || /(?:^|\/)\.(?:env|dev\.vars)(?!\.example$)/.test(path)) throw Error('Excluded release path');
}
function file(path) {
  validatePath(path);
  let current = root;
  for (const part of path.split('/')) { current = resolve(current, part); if (lstatSync(current).isSymbolicLink()) throw Error('Release symlink refused'); }
  if (lstatSync(current).size > 4 * 1024 * 1024) throw Error('Release input exceeds 4 MiB');
  if (!lstatSync(current).isFile()) throw Error('Release input must be regular');
  const bytes = readFileSync(current);
  if (bytes.length > 4 * 1024 * 1024) throw Error('Release input exceeds 4 MiB');
  if (!path.endsWith('.woff2') && /\/home\/agent\/|Infrastructure\/wiki|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(bytes.toString())) throw Error('Private material found in release input (inspect privately)');
  return bytes;
}
function tarEntry(path, bytes) {
  const h = Buffer.alloc(512);
  const put = (value, offset, length) => h.write(value, offset, length, 'ascii');
  put(path, 0, 100); put('0000644\0', 100, 8); put('0000000\0',108,8); put('0000000\0',116,8);
  put(bytes.length.toString(8).padStart(11,'0')+'\0',124,12); put('00000000000\0',136,12);
  h.fill(32,148,156); put('0',156,1); put('ustar\0',257,6); put('00',263,2);
  put([...h].reduce((a,b)=>a+b,0).toString(8).padStart(6,'0')+'\0 ',148,8);
  return Buffer.concat([h, bytes, Buffer.alloc((512-bytes.length%512)%512)]);
}
export function release() {
  if (process.argv.length > 3) throw Error('Usage: npm run release:source -- .scratch/release-name');
  const out = resolve(root, process.argv[2] ?? '.scratch/source-release');
  if (!relative(resolve(root,'.scratch'),out) || relative(resolve(root,'.scratch'),out).startsWith('..')) throw Error('Output must be a new directory beneath .scratch');
  if (existsSync(out)) throw Error('Output already exists');
  let parent = dirname(out);
  while (parent !== root) { if (existsSync(parent) && (!lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink())) throw Error('Unsafe output parent'); parent = dirname(parent); }
  let revision;
  if (existsSync(resolve(root,'.git'))) {
    const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
    if (git(['status','--porcelain','--untracked-files=normal'])) throw Error('Commit source changes before release');
    revision = git(['rev-parse','HEAD']);
  } else revision = JSON.parse(readFileSync(resolve(root,'SOURCE_MANIFEST.json'))).revision;
  if (!/^[a-f0-9]{40}$/.test(revision)) throw Error('Missing source revision');
  const paths = JSON.parse(readFileSync(resolve(root,'release-files.json')));
  if (!Array.isArray(paths) || paths.length > 500 || new Set(paths).size !== paths.length || paths.includes('SOURCE_MANIFEST.json')) throw Error('Invalid allowlist');
  const entries = paths.sort().map(path => ({path, bytes:file(path)}));
  if (entries.reduce((n,e)=>n+e.bytes.length,0)>16*1024*1024) throw Error('Release exceeds 16 MiB');
  const manifest = Buffer.from(JSON.stringify({format:1, name:'postdeploy-analytics',version:JSON.parse(file('package.json')).version,revision,files:entries.map(e=>({path:e.path,size:e.bytes.length,sha256:sha(e.bytes)}))},null,2)+'\n');
  if (!existsSync(resolve(root,'.git'))) {
    if (!manifest.equals(readFileSync(resolve(root,'SOURCE_MANIFEST.json')))) throw Error('Extracted source differs from original manifest');
  } else {
    const tracked = new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0'));
    if (paths.some(p=>!tracked.has(p))) throw Error('Untracked allowlist input');
  }
  const archive = gzipSync(Buffer.concat([...entries.map(e=>tarEntry(e.path,e.bytes)),tarEntry('SOURCE_MANIFEST.json',manifest),Buffer.alloc(1024)]),{level:9});
  const fs = statfsSync(root); if (fs.bavail*fs.bsize-archive.length-manifest.length < 10*1024**3) throw Error('10 GiB reserve required');
  mkdirSync(out,{recursive:true,mode:0o700});
  writeFileSync(resolve(out,'postdeploy-analytics-0.1.0.tar.gz'),archive,{mode:0o600,flag:'wx'});
  writeFileSync(resolve(out,'SOURCE_MANIFEST.json'),manifest,{mode:0o600,flag:'wx'});
  writeFileSync(resolve(out,'SHA256SUMS'),`${sha(archive)}  postdeploy-analytics-0.1.0.tar.gz\n${sha(manifest)}  SOURCE_MANIFEST.json\n`,{mode:0o600,flag:'wx'});
  console.log(`Source archive: ${out}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) release();
