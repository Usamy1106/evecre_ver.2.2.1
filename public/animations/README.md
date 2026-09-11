# public/animations/

Lottie（After Effects → Bodymovin 書き出し）のアニメーションデータを置く場所。

## 置き方

1. AE から Bodymovin で書き出し、**LottieFiles のクラウドには保存せず**
   ローカルにダウンロードした `.json` をこのフォルダへ置く
2. 参照は `/animations/<name>.json`（自ドメイン）。**CDN や lottie.host を使わないこと**

## なぜセルフホストなのか

LottieFiles の無料プランの保存数・帯域にアプリの動作を左右されないため。
今後アニメーションを増やしていく前提なので、再生ライブラリ（`lottie-web`）も
`public/js/vendor/lottie-web/` に同梱してある。

## 現在使っているもの

| ファイル | 使う場所 | 内容 |
|---|---|---|
| `fire-idle.json` | `modals/leaderMotivationModal.js` | 🔥の常時ループ（揺らぐ炎＋瞬き・視線）|
| `fire-pressed.json` | 同上 | タップ時に1回再生（目が上を向く）。再生完了でモーダルが退場する |

★**どちらも未配置でも壊れない。** 読み込みに失敗したら絵文字 `🔥` に落ちる
（`data_failed` を拾って `.p-invite__fire-fallback` を出す）。この逃げ道を消さないこと。

## キャッシュ

`.json` は `server.js` の `no-cache` 正規表現（js/html/css/md）に**入っていない**ので、
express.static の既定（`max-age=0` ＋ ETag）で配信される。毎回 ETag 再検証が走るため、
**同じ名前で中身だけ差し替えても次のリロードで反映される**（`images/bg` のような
immutable 長期キャッシュは付けないこと。差し替え運用があるファイルなので）。

## ライブラリ側の制約

`lottie_light` ビルドを使っているので、**AE の expression（式）は再生できない**。
式を使った場合はコンソールに警告が出るので、`public/js/vendor/lottie-web/` の
コメントに従ってフル版へ差し替えること。
