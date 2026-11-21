/**
 * 本番のビルド (仕様 docs/spec-app.md §6-2)。使い方 (native/ で):
 *   node scripts/release.mjs android  … AAB をアップロード鍵で署名して dist/ に置く (Google Play へは Play Console で上げる)
 *   node scripts/release.mjs ios      … アーカイブ → App Store Connect に上げる (TestFlight)。Xcode にチームのアカウントでログインしておく
 * どちらも: Web 版を本番の広告で写す (build.mjs --ads=release) → 版と設定を入れる (configure.mjs) → アプリへ写す (cap sync)
 * ストアに上げ直すときは package.json の appBuild を 1 増やしてから流す (同じ番号は 2 回上げられない)
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const NATIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(NATIVE, 'dist');
const APP = JSON.parse(await readFile(path.join(NATIVE, 'package.json'), 'utf8'));
const NAME = `ekiroulette-${APP.version}-${APP.appBuild}`;
const TEAM_ID = 'YCYKLCPU96';
const JAVA_HOME = process.env.JAVA_HOME || '/opt/homebrew/opt/openjdk@21';
const KEYSTORE = path.join(os.homedir(), 'Library/Application Support/PokerLab/android-upload-keys/ekiroulette-upload.jks');
const KEYCHAIN_SERVICE = 'ekiroulette-upload-key';
const REAL_PUBLISHER = 'ca-app-pub-4798502599946388';
const TEST_PUBLISHER = 'ca-app-pub-3940256099942544';

const target = process.argv[2];
if (!['android', 'ios'].includes(target)) {
  console.error('使い方: node scripts/release.mjs android|ios');
  process.exit(2);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', cwd: NATIVE, ...opts });

/** できたアプリの native.js に本物の広告 ID だけが入っているか */
function checkAdIds(js, where) {
  if (!js.includes(REAL_PUBLISHER) || js.includes(TEST_PUBLISHER)) throw new Error(`${where}: 本物の広告 ID だけになっていない`);
}

run('node', ['scripts/build.mjs', '--ads=release']);
run('node', ['scripts/configure.mjs']);
run('npx', ['cap', 'sync', target]);
await mkdir(DIST, { recursive: true });

if (target === 'android') {
  const android = path.join(NATIVE, 'android');
  // パスワードはキーチェーンから環境変数で gradle に渡すだけ (表示しない・ファイルに書かない)
  const password = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w']).toString().trim();
  run('./gradlew', ['--no-daemon', '-q', 'clean', 'bundleRelease'], {
    cwd: android,
    env: { ...process.env, JAVA_HOME, EKI_UPLOAD_KEYSTORE: KEYSTORE, EKI_UPLOAD_PASSWORD: password },
  });
  const aab = path.join(android, 'app/build/outputs/bundle/release/app-release.aab');
  const verify = execFileSync(path.join(JAVA_HOME, 'bin/jarsigner'), ['-J-Duser.language=en', '-verify', '-verbose:summary', '-certs', aab]).toString();
  if (!verify.includes('jar verified') || !verify.includes('CN=POKER LAB K.K.')) throw new Error('AAB の署名がアップロード鍵になっていない');
  checkAdIds(execFileSync('unzip', ['-p', aab, 'base/assets/public/js/native.js']).toString(), 'AAB');
  const out = path.join(DIST, `${NAME}.aab`);
  await copyFile(aab, out);
  console.log(`OK: ${out} (アップロード鍵で署名・本物の広告 ID)`);
} else {
  const archive = path.join(DIST, `${NAME}.xcarchive`);
  await rm(archive, { recursive: true, force: true });
  run('xcodebuild', [
    '-project', 'App.xcodeproj', '-scheme', 'App', '-configuration', 'Release',
    '-destination', 'generic/platform=iOS', '-archivePath', archive,
    // アーカイブは署名なしで作り、下の書き出しで配布用に署名する。自動署名のアーカイブは開発用のプロファイルを作ろうとし、
    // 登録した端末が無いと失敗する (実測)。書き出しは Apple の配布用の証明書 (クラウド管理) と App Store 用のプロファイルを使う
    'CODE_SIGNING_ALLOWED=NO',
    'archive',
  ], { cwd: path.join(NATIVE, 'ios/App') });
  const appDir = path.join(archive, 'Products/Applications/App.app');
  checkAdIds(await readFile(path.join(appDir, 'public/js/native.js'), 'utf8'), 'アーカイブ');
  // Google の広告の部品 (GoogleMobileAds・UserMessagingPlatform) は仮の署名 (ad hoc) つきで配られる。署名なしのアーカイブでは
  // それが残り、書き出しで配布用に署名し直されず、App Store Connect が「署名が正しくない」と断る (実測) → 仮の署名を外してから書き出す
  for (const name of await readdir(path.join(appDir, 'Frameworks'))) {
    if (!name.endsWith('.framework')) continue;
    const bin = path.join(appDir, 'Frameworks', name, name.replace(/\.framework$/, ''));
    const info = spawnSync('codesign', ['-dv', bin], { encoding: 'utf8' }); // 署名の情報は stderr に出る
    if (/Signature=adhoc/.test(`${info.stdout}${info.stderr}`)) {
      execFileSync('codesign', ['--remove-signature', bin]);
      await rm(path.join(appDir, 'Frameworks', name, '_CodeSignature'), { recursive: true, force: true });
      console.log(`仮の署名を外した: ${name}`);
    }
  }
  // 外したあと、アプリの中に仮の署名が残っていないか
  for (const name of await readdir(path.join(appDir, 'Frameworks'))) {
    if (!name.endsWith('.framework')) continue;
    const left = spawnSync('codesign', ['-dv', path.join(appDir, 'Frameworks', name)], { encoding: 'utf8' });
    if (/Signature=adhoc/.test(`${left.stdout}${left.stderr}`)) throw new Error(`仮の署名が残っている: ${name}`);
  }
  // App Store Connect に上げる (method = app-store-connect・destination = upload)。版と番号は package.json のまま変えさせない
  const options = path.join(DIST, 'ExportOptions.plist');
  await writeFile(options, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
`);
  run('xcodebuild', [
    '-exportArchive', '-archivePath', archive, '-exportOptionsPlist', options,
    '-exportPath', path.join(DIST, `${NAME}-ios-export`), '-allowProvisioningUpdates',
  ]);
  console.log(`OK: ${archive} を App Store Connect に上げた (TestFlight に出るまで数分〜数十分)`);
}
