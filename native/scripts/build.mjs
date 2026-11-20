/**
 * アプリに入れる www/ を作る。
 * 使い方 (native/ で): node scripts/build.mjs --ads=test|release  → そのあと npx cap sync
 *   - Web 版のファイル (index.html・style.css・js/・data/・fonts/・icons/・manifest) を www/ に写す。sw.js は写さない
 *   - src/native.js を esbuild で 1 ファイルにまとめて www/js/native.js にする (広告の種類と版を埋め込む)
 *   - Firebase の設定ファイル (../firebase/) を、作ってあるプラットフォームのフォルダに写す
 * 仕様: docs/spec-app.md §1
 */
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const NATIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(NATIVE, '..');
const WWW = path.join(NATIVE, 'www');
const WEB_FILES = ['index.html', 'style.css', 'manifest.webmanifest', 'js', 'data', 'fonts', 'icons'];
const FIREBASE = [
  { from: 'GoogleService-Info.plist', to: 'ios/App/App/GoogleService-Info.plist', platform: 'ios' },
  { from: 'google-services.json', to: 'android/app/google-services.json', platform: 'android' },
];

const exists = (p) => stat(p).then(() => true, () => false);

const arg = process.argv.find((a) => a.startsWith('--ads='));
const ads = arg?.slice('--ads='.length);
if (ads !== 'test' && ads !== 'release') {
  console.error('使い方: node scripts/build.mjs --ads=test|release');
  process.exit(1);
}

const { version } = JSON.parse(await readFile(path.join(NATIVE, 'package.json'), 'utf8'));

await rm(WWW, { recursive: true, force: true });
await mkdir(WWW, { recursive: true });
for (const name of WEB_FILES) {
  await cp(path.join(ROOT, name), path.join(WWW, name), { recursive: true });
}

await build({
  entryPoints: [path.join(NATIVE, 'src', 'native.js')],
  outfile: path.join(WWW, 'js', 'native.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15'],
  minify: true,
  legalComments: 'eof',
  define: {
    __ADS_MODE__: JSON.stringify(ads),
    __APP_VERSION__: JSON.stringify(version),
  },
  logLevel: 'warning',
});

for (const file of FIREBASE) {
  const src = path.join(ROOT, 'firebase', file.from);
  const platformDir = path.join(NATIVE, file.platform);
  if (!(await exists(platformDir))) continue;
  if (!(await exists(src))) {
    console.error(`Firebase の設定ファイルが無い: firebase/${file.from}`);
    process.exit(1);
  }
  await cp(src, path.join(NATIVE, file.to));
}

console.log(`OK: www/ を作った (広告 = ${ads}・版 ${version})`);
