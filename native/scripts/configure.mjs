/**
 * android/ と ios/ (npx cap add で作ったもの) に、アプリの設定を入れる。何度流しても同じ結果になる。
 * 使い方 (native/ で): node scripts/configure.mjs
 *   Android: allowBackup = false / AdMob のアプリ ID (meta-data + strings)
 *   iOS: Info.plist (AdMob のアプリ ID・追跡の許可の説明文・SKAdNetwork・暗号の申告) / GoogleService-Info.plist を Xcode のターゲットに足す
 * 仕様: docs/spec-app.md §1・§4。SKAdNetwork の一覧 = config/skadnetwork-ids.txt (Google の iOS クイックスタートのページから)
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NATIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMOB_APP_ID = {
  android: 'ca-app-pub-4798502599946388~1411264833',
  ios: 'ca-app-pub-4798502599946388~2212055663',
};
const ATT_TEXT = 'あなたに合った広告を表示するために使います';
const exists = (p) => stat(p).then(() => true, () => false);

async function edit(file, fn) {
  const before = await readFile(file, 'utf8');
  const after = fn(before);
  if (after !== before) await writeFile(file, after);
  return after !== before;
}

async function configureAndroid() {
  const dir = path.join(NATIVE, 'android');
  if (!(await exists(dir))) return 'なし';
  const manifest = path.join(dir, 'app/src/main/AndroidManifest.xml');
  await edit(manifest, (xml) => {
    let out = xml.replace('android:allowBackup="true"', 'android:allowBackup="false"');
    if (!out.includes('com.google.android.gms.ads.APPLICATION_ID')) {
      out = out.replace(
        /(<application[^>]*>)/,
        '$1\n        <meta-data\n            android:name="com.google.android.gms.ads.APPLICATION_ID"\n            android:value="@string/admob_app_id" />\n',
      );
    }
    return out;
  });
  const strings = path.join(dir, 'app/src/main/res/values/strings.xml');
  await edit(strings, (xml) => (xml.includes('name="admob_app_id"')
    ? xml.replace(/<string name="admob_app_id">[^<]*<\/string>/, `<string name="admob_app_id">${ADMOB_APP_ID.android}</string>`)
    : xml.replace('</resources>', `    <string name="admob_app_id">${ADMOB_APP_ID.android}</string>\n</resources>`)));
  const check = await readFile(manifest, 'utf8');
  if (!check.includes('android:allowBackup="false"') || !check.includes('@string/admob_app_id')) {
    throw new Error('AndroidManifest.xml を直せなかった');
  }
  return 'OK';
}

const BUILD_FILE_ID = 'EE1A00000000000000000001';
const FILE_REF_ID = 'EE1A00000000000000000002';

async function configureIos() {
  const dir = path.join(NATIVE, 'ios');
  if (!(await exists(dir))) return 'なし';
  const plist = path.join(dir, 'App/App/Info.plist');
  const plutil = (...args) => execFileSync('plutil', [...args, plist]);
  plutil('-replace', 'GADApplicationIdentifier', '-string', ADMOB_APP_ID.ios);
  plutil('-replace', 'NSUserTrackingUsageDescription', '-string', ATT_TEXT);
  plutil('-replace', 'ITSAppUsesNonExemptEncryption', '-bool', 'NO');
  const ids = (await readFile(path.join(NATIVE, 'config/skadnetwork-ids.txt'), 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);
  if (ids.length < 1 || !ids.every((id) => /^[a-z0-9]{10}\.skadnetwork$/.test(id))) throw new Error('skadnetwork-ids.txt の形がおかしい');
  plutil('-replace', 'SKAdNetworkItems', '-json', JSON.stringify(ids.map((id) => ({ SKAdNetworkIdentifier: id }))));
  execFileSync('plutil', ['-lint', plist]);

  // GoogleService-Info.plist を App ターゲットの Resources に入れる (capacitor.config.json と同じ並びに足す)
  const pbx = path.join(dir, 'App/App.xcodeproj/project.pbxproj');
  await edit(pbx, (text) => {
    if (text.includes(FILE_REF_ID)) return text;
    const name = 'GoogleService-Info.plist';
    const steps = [
      ['/* Begin PBXBuildFile section */\n', `\t\t${BUILD_FILE_ID} /* ${name} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF_ID} /* ${name} */; };\n`],
      ['/* Begin PBXFileReference section */\n', `\t\t${FILE_REF_ID} /* ${name} */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "${name}"; sourceTree = "<group>"; };\n`],
      ['50379B222058CBB4000EE86E /* capacitor.config.json */,\n', `\t\t\t\t${FILE_REF_ID} /* ${name} */,\n`],
      ['50B271D11FEDC1A000F3C39B /* public in Resources */,\n', `\t\t\t\t${BUILD_FILE_ID} /* ${name} in Resources */,\n`],
    ];
    let out = text;
    for (const [anchor, insert] of steps) {
      const at = out.indexOf(anchor);
      if (at < 0) throw new Error(`project.pbxproj に目印が無い: ${anchor.trim()}`);
      // 目印が一覧の要素 (行の途中) なら、その行の次に足す
      const end = at + anchor.length;
      out = out.slice(0, end) + insert + out.slice(end);
    }
    return out;
  });
  return 'OK';
}

console.log(`android: ${await configureAndroid()} / ios: ${await configureIos()}`);
