/**
 * android/ と ios/ (npx cap add で作ったもの) に、アプリの設定を入れる。何度流しても同じ結果になる。
 * 使い方 (native/ で): node scripts/configure.mjs
 *   Android: allowBackup = false / AdMob のアプリ ID (meta-data + strings) / 縦だけ / アイコンの背景色と起動画面のテーマ (雛形の splash.png を消す)
 *   iOS: Info.plist (AdMob のアプリ ID・追跡の許可の説明文・SKAdNetwork・暗号の申告・縦だけ) / GoogleService-Info.plist を Xcode のターゲットに足す / iPhone 専用
 * アイコンと起動画面の絵は tools/make_icons.py --app が書く。
 * 仕様: docs/spec-app.md §1・§4・§5-2。SKAdNetwork の一覧 = config/skadnetwork-ids.txt (Google の iOS クイックスタートのページから)
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, stat, readdir, rm, rmdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const NATIVE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMOB_APP_ID = {
  android: 'ca-app-pub-4798502599946388~1411264833',
  ios: 'ca-app-pub-4798502599946388~2212055663',
};
const ATT_TEXT = 'あなたに合った広告を表示するために使います';
/** アイコンの地・起動画面の色 (Web 版のアイコンと同じ黄色) */
const BRAND_YELLOW = '#FFE110';
const LAUNCH_COLOR = '<color key="backgroundColor" red="1" green="0.88235294117647056" blue="0.062745098039215685" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>';
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
    // 画面の向き = 縦だけ (仕様 §5-2)。activity は MainActivity の 1 つだけ
    if (!out.includes('android:screenOrientation=')) out = out.replace('<activity', '<activity\n            android:screenOrientation="portrait"');
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
  // アイコンの地と起動画面: テーマの背景色 + アプリのアイコン。雛形の引き伸ばす絵 (drawable*/splash.png) は使わない (仕様 §5-2)
  const res = path.join(dir, 'app/src/main/res');
  await edit(path.join(res, 'values/ic_launcher_background.xml'), (xml) => xml.replace(
    /(<color name="ic_launcher_background">)[^<]*(<\/color>)/, `$1${BRAND_YELLOW}$2`,
  ));
  await edit(path.join(res, 'values/styles.xml'), (xml) => xml.replace(
    /(<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">)[\s\S]*?(<\/style>)/,
    '$1\n        <item name="windowSplashScreenBackground">@color/ic_launcher_background</item>\n'
      + '        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher</item>\n    $2',
  ));
  for (const folder of (await readdir(res)).filter((name) => name.startsWith('drawable'))) {
    const png = path.join(res, folder, 'splash.png');
    if (await exists(png)) await rm(png);
    if ((await readdir(path.join(res, folder))).length === 0) await rmdir(path.join(res, folder));
  }
  const check = await readFile(manifest, 'utf8');
  const styles = await readFile(path.join(res, 'values/styles.xml'), 'utf8');
  if (!check.includes('android:allowBackup="false"') || !check.includes('@string/admob_app_id')
    || !check.includes('android:screenOrientation="portrait"')) {
    throw new Error('AndroidManifest.xml を直せなかった');
  }
  if (!styles.includes('windowSplashScreenBackground') || styles.includes('@drawable/splash')) throw new Error('styles.xml を直せなかった');
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
  plutil('-replace', 'UISupportedInterfaceOrientations', '-json', JSON.stringify(['UIInterfaceOrientationPortrait']));
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
  // 起動画面: 背景色 = 黄色・真ん中に Splash (160pt) を拡大縮小せずに (仕様 §5-2)
  const launch = path.join(dir, 'App/App/Base.lproj/LaunchScreen.storyboard');
  await edit(launch, (xml) => xml
    .replace(/(<imageView key="view"[^>]*?)contentMode="[^"]*"/, '$1contentMode="center"')
    .replace(/(<imageView key="view"[\s\S]*?)<color key="backgroundColor"[^>]*\/>/, `$1${LAUNCH_COLOR}`)
    .replace(/<image name="Splash" width="[^"]*" height="[^"]*"\/>/, '<image name="Splash" width="160" height="160"/>'));
  const launchXml = await readFile(launch, 'utf8');
  if (!launchXml.includes('contentMode="center"') || !launchXml.includes(LAUNCH_COLOR) || !launchXml.includes('width="160"')) {
    throw new Error('LaunchScreen.storyboard を直せなかった');
  }

  // iPhone 専用 (仕様 §5-2)
  await edit(pbx, (text) => text.replaceAll('TARGETED_DEVICE_FAMILY = "1,2";', 'TARGETED_DEVICE_FAMILY = 1;'));
  if ((await readFile(pbx, 'utf8')).includes('TARGETED_DEVICE_FAMILY = "1,2"')) throw new Error('iPhone 専用にできなかった');
  return 'OK';
}

console.log(`android: ${await configureAndroid()} / ios: ${await configureIos()}`);
