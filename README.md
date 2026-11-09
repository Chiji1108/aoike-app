# 行政書士青池事務所 app.aoike.jp

事務所の社内ツールを1つにまとめた Web アプリです（Worker 1つ・ログイン1回）。トップはツールの一覧（ポータル）で、ツールはパスで分けます。

公開リポジトリです。顧客や職員の実名・実データは、コード・テスト・コミット・PR に入れないでください。
2026-11 に勤怠のリポジトリ（非公開の Chiji1108/aoike-attendance）から、履歴を1コミットにまとめて移しました。
公開URL：https://app.aoike.jp

| ツール | パス | メモ |
| --- | --- | --- |
| 勤怠 | `/kintai` | 旧 https://kintai.aoike.jp（今は app.aoike.jp/kintai への転送だけ） |
| 工事経歴書 CSV | — | まだ https://csv.aoike.jp（別リポジトリ aoike-kensetsu-csv）。ポータルからはリンクだけ |

- ログインは全ツール共通で、認証（ユーザー・セッション）は共通の D1 `aoike-auth`（バインディング `AUTH_DB`）に置く。業務データはツールごとの D1（勤怠は `aoike-attendance`、バインディング `KINTAI_DB`）
- ユーザーには役割（`role`）がある。今は事務所アカウント（`office`）だけで、SHARP 用の閲覧アカウントなどはあとから足す（`src/lib/constants.ts` の `USER_ROLES`、`src/server/middleware.ts`）

## 勤怠

スタッフの勤怠を入力・集計し、A4縦の「勤務報告書」を印刷／PDF保存できます。

- 勤怠は **毎月20日締め**（例：2026年10月分 ＝ 2026/9/21〜10/20）
- ログインは事務所共通のパスワードのみ（ユーザー登録画面はありません）
- 従業員ごとのログインアカウントは不要（他のスタッフの代理入力も可能）

## 技術スタック

TanStack Start / React / TypeScript / Tailwind CSS v4 / shadcn/ui / Cloudflare Workers / Cloudflare D1 / Drizzle ORM / Better Auth / Zod / Bun

## 画面

| 画面 | 内容 |
| --- | --- |
| ログイン `/login` | パスワードのみ入力。ログイン状態は90日間保持（利用するたびに延長）。ログインすると、開こうとしていたページに戻る |
| ポータル `/` | ツールの一覧 |
| 勤怠 `/kintai` | 従業員の切り替え、期間（20日締め）の切り替え、集計、期間内の全日一覧。日付をタップして入力・編集 |
| 従業員 `/kintai/employees` | 追加・編集（氏名・通勤費）・無効化（無効にしても過去の勤怠は保持） |
| 勤務報告書 `/kintai/report` | A4縦の帳票プレビュー。「印刷 / PDFで保存」からブラウザの印刷機能で出力 |

### 入力の工夫

- 新規入力の初期値は **その従業員の前回の入力内容**（出勤・退勤・休憩）。前回がなければ 9:00 / 16:00 / 休憩60分。残業は常に0分から
- 休憩・残業はよく使う時間をワンタップで選択でき、分単位で自由入力も可能
- 「保存して次の平日へ」で、同じ時刻のまま翌営業日を続けて入力できる
- 残業時間は自動計算せず手入力（所定時間・フレックスの違いに対応）
- 前回選択した従業員を端末ごとに記憶

### 通勤費

従業員ごとに「なし／定期／都度」を設定します（業務上の交通費は対象外。通勤費は給与に含めて支給する前提）。

- **定期**：通勤経路と定期代の月額を登録。毎月の勤務報告書に月額を載せる（6ヶ月定期なら ÷6 した額を登録）
- **都度**：通勤経路と片道運賃を登録。勤怠の新規入力時に往復分が初期値で入り、直行直帰などの日は「片道」「なし」や金額の直接入力で変更できる。一覧には往復と違う日だけ金額を表示
- 勤務報告書：都度の人は日別の「通勤費」列、どちらも合計欄の下に通勤費の行（方法・経路・期間の合計）が入る
- 都度の金額は日ごとに保存するので、運賃を変えても過去の報告書は変わらない。定期の月額と通勤方法は従業員の現在の設定で表示する

## 開発環境のセットアップ

```bash
bun install
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を32文字以上のランダム値に変更
bun run db:migrate               # ローカル D1（認証用・勤怠用）にテーブル作成
bun run set-password             # 事務所共通パスワードを設定（ローカル）
bun run dev                      # http://localhost:3210
```

`BETTER_AUTH_SECRET` は `openssl rand -base64 32` などで生成してください。

## 既存のチェックアウトからの移行（apps/web 構成のときに clone していた場合）

ローカル用のシークレットとローカル D1 のデータは git の管理外なので、pull しても `apps/web` に残ります。ルートに移してください。

```bash
mv apps/web/.dev.vars .                                  # ローカル用シークレット
mkdir -p .wrangler && mv apps/web/.wrangler/state .wrangler/   # ローカル D1 のデータ
rm -rf apps                                              # 古い生成物（node_modules・dist など）
bun install
```

## 本番環境（Cloudflare）へのデプロイ

```bash
# 1. D1 データベースを作成し、表示された database_id を wrangler.jsonc に設定
bunx wrangler d1 create aoike-auth
bunx wrangler d1 create aoike-attendance

# 2. テーブル作成
bun run db:migrate:remote

# 3. シークレットを設定（公開URL BETTER_AUTH_URL は wrangler.jsonc の vars にある）
bunx wrangler secret put BETTER_AUTH_SECRET   # 32文字以上のランダム文字列

# 4. デプロイ
bun run deploy

# 5. 事務所共通パスワードを設定
bun run set-password --remote
```

### 公開URL（app.aoike.jp）

aoike.jp のDNSは外部（ラディックス）で管理していてネームサーバーを変えられないため、Workers のカスタムドメインは使えません。
代わりに Cloudflare for SaaS（SaaS ゾーン `chiji.tech`）の Custom Hostname として受け、`wrangler.jsonc` の `routes` で本 Worker に直接つないでいます。
kintai.aoike.jp も同じ形で受けていて、来たアクセスは app.aoike.jp/kintai の同じページへ転送します（`src/lib/legacy-host.ts`）。

```
ブラウザ ──> app.aoike.jp (CNAME) ──> saas.chiji.tech（Cloudflare for SaaS）──(routes)──> Worker: aoike-attendance
```

ホスト名ごと（`app` と `kintai`）に次を設定しています。

| 場所 | 設定 |
| --- | --- |
| ラディックス（aoike.jp） | `<host>` CNAME `saas.chiji.tech` |
| ラディックス（aoike.jp） | `_acme-challenge.<host>` CNAME `<host>.aoike.jp.<DCV Delegation の値>.dcv.cloudflare.com`（証明書の発行・更新を Cloudflare に任せる） |
| ラディックス（aoike.jp） | `_cf-custom-hostname.<host>` TXT（ホスト名の所有確認） |
| Cloudflare（chiji.tech） | SSL/TLS → Custom Hostnames に `<host>.aoike.jp`（最小 TLS 1.2、TXT Validation） |
| Cloudflare（chiji.tech） | fallback origin `fallback.chiji.tech`（AAAA `100::`、プロキシ有効）と `saas` CNAME `fallback.chiji.tech`（プロキシ有効） |
| このリポジトリ | `wrangler.jsonc` の `routes`：`app.aoike.jp/*` と `kintai.aoike.jp/*`（`zone_name: chiji.tech`） |

`_acme-challenge` と `_cf-custom-hostname` の値は Custom Hostnames の画面で確認できます。

### 自動デプロイ（Workers Builds）

`main` への push で Workers Builds がビルド・デプロイします。

Workers & Pages → `aoike-attendance` → 設定 → ビルド

| 項目 | 値 |
| --- | --- |
| ルートディレクトリ | （空欄＝リポジトリのルート） |
| ビルドコマンド | `bun run build` |
| デプロイコマンド | `bunx wrangler deploy` |
| 本番以外のブランチのビルド（Preview builds） | オフ（ブランチのビルドは Previews 機能として実行され、`wrangler preview` とプレビュー専用 D1 の `previews` 設定が必要になるため使わない） |
| ビルドの監視パス | なし（すべての変更でビルド） |
| ビルド変数 `BUN_VERSION` | `1.4.2`（手元の Bun と合わせる。既定の 1.2.15 は `bun.lock` を読めない） |

### パスワードの変更

- アプリ右上のメニュー →「パスワード変更」から変更できます（他端末をログアウトさせるかを選択可）
- パスワードを忘れた場合は `bun run set-password --remote` で再設定できます（全端末がログアウトされます）

## 勤務報告書（PDF）

- 勤怠画面の「勤務報告書（PDF）」→「印刷 / PDFで保存」
- 印刷画面で送信先を「PDFに保存」にするとPDFになります（ファイル名は `勤務報告書_氏名_2026年10月分`）
- 用紙 A4・縦、倍率 100% で1ページに収まるようにレイアウトしています
- 氏名のすぐ右に 27mm 角の押印欄があります（印刷後に押印）

## 設計メモ

### 認証

- Better Auth の Email & Password を使用。メールアドレスは `src/lib/constants.ts` の `OFFICE_ACCOUNT_EMAIL` に固定し、ログイン画面ではパスワードのみ入力
- `disableSignUp: true` で公開登録を無効化。アカウントは `scripts/set-password.ts` で作成
- パスワードハッシュは Workers の CPU 制限を考慮し、Web Crypto ネイティブの PBKDF2-SHA256（100,000回）を使用（`src/lib/password.ts`）
- ログイン試行は D1 を使ったレート制限（1分間に5回まで）
- サーバー関数は同一オリジンからの呼び出しのみ許可（`src/start.ts` の CSRF ミドルウェア）

### 将来の個別アカウント移行

認証ユーザー（`user` テーブル）と従業員（`employees` テーブル）は独立しています。個別アカウントに移行する場合は、

1. `employees` に `user_id`（nullable）を追加して紐付け
2. ログイン画面にメールアドレス（またはユーザー名）入力を追加
3. 必要に応じて Better Auth の `admin` プラグインで権限を管理

という手順で、既存の勤怠データをそのまま使えます。

### データ構造

- `employees` … 氏名・有効/無効・表示順・通勤費の設定（`commute_type` / `commute_route` / `commute_one_way_fare` / `commute_pass_monthly`）
- `attendance_records` … 従業員 × 勤務日で1件（`work_date` は `YYYY-MM-DD`、時刻は `HH:MM`、休憩・残業は分、`commute_fare` はその日の通勤費（円、都度の人のみ））
- 実働時間 ＝ 退勤 − 出勤 − 休憩（保存せず表示時に計算）
- 20日締めの期間計算は `src/lib/period.ts` に集約（一覧・集計・PDFで共通）

### スキーマ変更時

```bash
bun run db:generate        # drizzle/ にマイグレーションSQLを生成
bun run db:migrate         # ローカルに適用
bun run db:migrate:remote  # 本番に適用
```

## ディレクトリ構成

```
src/
  routes/
    login.tsx              ログイン
    _authed.tsx            ログイン必須レイアウト
    _authed/index.tsx      勤怠（一覧・集計・入力）
    _authed/employees.tsx  従業員管理
    _authed/report.tsx     勤務報告書（印刷）
    api/auth/$.ts          Better Auth ハンドラー
  components/
    attendance/            勤怠画面の部品（入力ダイアログ・日別一覧など）
    report/report-sheet.tsx  A4帳票
    ui/                    shadcn/ui
  server/                  サーバー関数（Zod で入力検証、要ログイン）
  db/                      Drizzle スキーマ
  lib/                     期間計算・時間計算・認証設定
scripts/set-password.ts    共通パスワードの設定
drizzle/                   マイグレーション
```
