#!/bin/zsh
# Google Play に出すときの「アップロード鍵」を作る (アプリごとに 1 回だけ)。仕様: docs/spec-app.md §6-2
# - 鍵のファイルはリポの外 (下の KEYSTORE)。パスワードはここで乱数で作り、Mac のキーチェーンにだけ入れる (画面・ログに出さない)
# - Google Play はアップロード鍵で届いたものを確かめ、配るアプリには Google が持つ「アプリ署名鍵」で署名し直す (Play アプリ署名)
#   = この鍵をなくしても、Play Console から「アップロード鍵のリセット」を頼める
# 使い方 (native/ で): zsh scripts/make-upload-key.sh
set -euo pipefail

KEYSTORE="$HOME/Library/Application Support/PokerLab/android-upload-keys/ekiroulette-upload.jks"
SERVICE='ekiroulette-upload-key'
KEYTOOL="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}/bin/keytool"

if [[ -e "$KEYSTORE" ]] || security find-generic-password -s "$SERVICE" >/dev/null 2>&1; then
  echo "もうある (作り直さない): $KEYSTORE / キーチェーン $SERVICE" >&2
  exit 1
fi
mkdir -p "${KEYSTORE:h}"
chmod 700 "${KEYSTORE:h}"

EKI_PW="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32)"
[[ ${#EKI_PW} -eq 32 ]] || { echo 'パスワードを作れなかった' >&2; exit 1; }
export EKI_PW
# 先にキーチェーンへ入れる (鍵を作った後で保存に失敗すると、パスワードが失われて鍵が使えなくなるため)
# パスワードはコマンドの引数に載せない (実行中に ps で見える) → シェルの内部コマンド printf から security -i へ標準入力で渡す
printf 'add-generic-password -a upload -s %s -l %s -w %s\n' "$SERVICE" "$SERVICE" "$EKI_PW" | security -i
security find-generic-password -s "$SERVICE" >/dev/null 2>&1 || { echo 'キーチェーンに入れられなかった' >&2; exit 1; }
if ! "$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -storetype PKCS12 -alias upload \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass:env EKI_PW -keypass:env EKI_PW \
  -dname 'CN=POKER LAB K.K., O=POKER LAB K.K., L=Tokyo, C=JP' >/dev/null; then
  security delete-generic-password -s "$SERVICE" >/dev/null 2>&1
  echo '鍵を作れなかった (キーチェーンの項目も消した)' >&2
  exit 1
fi
unset EKI_PW
chmod 600 "$KEYSTORE"

# 確かめ: キーチェーンのパスワードで鍵が開ける (証明書の指紋だけ出す・秘密ではない)
FINGERPRINT="$(EKI_PW="$(security find-generic-password -s "$SERVICE" -w)" "$KEYTOOL" -list -v -keystore "$KEYSTORE" -storepass:env EKI_PW -alias upload | grep -E 'SHA256:' | head -1)"
[[ -n "$FINGERPRINT" ]] || { echo 'キーチェーンのパスワードで鍵が開けなかった' >&2; exit 1; }
echo "OK: アップロード鍵を作った"
echo "  鍵: $KEYSTORE"
echo "  パスワード: キーチェーン「$SERVICE」(画面には出していない)"
echo "  証明書の指紋 $FINGERPRINT"
