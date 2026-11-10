# 行政書士青池事務所 app.aoike.jp

事務所の社内ツールを1つにまとめた Web アプリです（Worker 1つ・ログイン1回）。トップはツールの一覧（ポータル）で、ツールはパスで分けます。
公開URL：https://app.aoike.jp

公開リポジトリです。顧客や職員の実名・実データは、コード・テスト・コミット・PR に入れないでください（顧客の実データは `sample/` に置き、git の管理外）。
2026-11 に勤怠（非公開の Chiji1108/aoike-attendance）と工事経歴書 CSV（Chiji1108/aoike-kensetsu-csv）から、履歴を1コミットにまとめて移しました。

| ツール | パス | 説明 | 旧 URL（今は転送だけ） |
| --- | --- | --- | --- |
| 勤怠 | `/kintai` | [docs/kintai.md](docs/kintai.md) | https://kintai.aoike.jp |
| 工事経歴書 CSV | `/csv` | [docs/csv.md](docs/csv.md) | https://csv.aoike.jp |
| FIT 申請 | `/fit` | [docs/fit.md](docs/fit.md) | — |

ポータルには、事務所のホームページ（公開前の確認用の URL）へのリンクもあります。

## 技術スタック

TanStack Start / React / TypeScript / Tailwind CSS v4 / shadcn/ui（Base UI 版） / Cloudflare Workers / Cloudflare D1 / R2 / Workflows / Drizzle ORM / Better Auth / Zod / Bun。ツールごとに足したライブラリは各ツールの説明にあります。

## 画面（共通）

| 画面 | 内容 |
| --- | --- |
| ログイン `/login` | パスワードのみ入力。ログイン状態は90日間保持（利用するたびに延長）。ログインすると、開こうとしていたページに戻る |
| ポータル `/` | ツールの一覧 |

デスクトップやタスクバーにアプリとして入れられます（PWA。`public/manifest.webmanifest`。オフライン対応はしない）。アイコンは `bun run icons` で作り直せます。

## 開発環境のセットアップ

```bash
bun install
cp .dev.vars.example .dev.vars   # BETTER_AUTH_SECRET を32文字以上のランダム値に。工事経歴書 CSV で AI を使うなら ANTHROPIC_API_KEY も
bun run db:migrate               # ローカル D1（認証用・勤怠・工事経歴書 CSV・FIT 申請）にテーブル作成
bun run set-password             # 事務所共通パスワードを設定（ローカル）
bun run dev                      # http://localhost:3210
bun test                         # 単体テスト
```

`BETTER_AUTH_SECRET` は `openssl rand -base64 32` などで生成してください。
ブラウザでの確認（e2e、`bun run e2e`）は [docs/csv.md](docs/csv.md#ブラウザでの確認e2e) を見てください。

## CI と依存ライブラリの更新

- PR と main への push で GitHub Actions（`.github/workflows/ci.yml`）が typecheck・`bun test`・build を流す。main は CI が通った PR だけを入れる（main に入ると Workers Builds が本番にデプロイするため）。e2e は Chrome とローカルの D1 が要るので CI では流さず、大きい版の更新のときは手元で `bun run e2e` を流す。
- 依存ライブラリの更新は Renovate（`renovate.json`）が月曜の朝に PR を出す。細かい更新は1つの PR にまとめ、大きい版の更新は別の PR。自動マージはしない。SheetJS（`xlsx`）は CDN の tgz から入れているので対象外で、手で更新する。

## データの置き場所

認証は全ツール共通の D1、業務データはツールごとの D1 に分けます（同じ Worker に複数つなぐ）。業務データの表は、ユーザーを外部キーにしません。

| バインディング | Cloudflare の名前 | 中身 | マイグレーション |
| --- | --- | --- | --- |
| `AUTH_DB` | D1 `aoike-auth` | Better Auth のユーザー・セッション | `drizzle/auth/` |
| `KINTAI_DB` | D1 `aoike-attendance` | 勤怠（従業員・勤怠） | `drizzle/kintai/` |
| `CSV_DB` | D1 `aoike-kensetsu-csv` | 工事経歴書 CSV（顧客・案件・ルール・要望など） | `drizzle/csv/` |
| `CSV_FILES` | R2 `aoike-kensetsu-csv-files` | 工事経歴書 CSV の案件のファイル・会話（公開アクセスなし） | — |
| `FIT_DB` | D1 `aoike-fit` | FIT 申請（案件・手続・不備・週次の案件表の記録） | `drizzle/fit/` |
| `LOCATION_SEARCH` | Workflow `aoike-app-location-search` | 工事経歴書 CSV の工事場所の一括調査（`src/worker.ts` から出す） | — |

## 本番環境（Cloudflare）へのデプロイ

```bash
# 1. D1 と R2 を作成し、表示された database_id を wrangler.jsonc に設定（R2 に公開アクセスは付けない）
bunx wrangler d1 create aoike-auth
bunx wrangler d1 create aoike-attendance
bunx wrangler d1 create aoike-kensetsu-csv
bunx wrangler d1 create aoike-fit
bunx wrangler r2 bucket create aoike-kensetsu-csv-files

# 2. テーブル作成
bun run db:migrate:remote

# 3. シークレットを設定（公開URL BETTER_AUTH_URL は wrangler.jsonc の vars にある）
bunx wrangler secret put BETTER_AUTH_SECRET   # 32文字以上のランダム文字列
bunx wrangler secret put ANTHROPIC_API_KEY    # Claude API のキー（工事経歴書 CSV）

# 4. デプロイ（工事場所の調査の Workflow は wrangler.jsonc の workflows から一緒に作られる）
bun run deploy

# 5. 事務所共通パスワードを設定
bun run set-password --remote
```

### 公開URL（app.aoike.jp）

aoike.jp のDNSは外部（ラディックス）で管理していてネームサーバーを変えられないため、Workers のカスタムドメインは使えません。
代わりに Cloudflare for SaaS（SaaS ゾーン `chiji.tech`）の Custom Hostname として受け、`wrangler.jsonc` の `routes` で本 Worker に直接つないでいます。
kintai.aoike.jp・csv.aoike.jp も同じ形で受けていて、来たアクセスは app.aoike.jp/kintai・/csv の同じページへ転送します（`src/lib/legacy-host.ts`）。

```
ブラウザ ──> app.aoike.jp (CNAME) ──> saas.chiji.tech（Cloudflare for SaaS）──(routes)──> Worker
```

ホスト名ごと（`app`・`kintai`・`csv`）に次を設定しています。

| 場所 | 設定 |
| --- | --- |
| ラディックス（aoike.jp） | `<host>` CNAME `saas.chiji.tech` |
| ラディックス（aoike.jp） | `_acme-challenge.<host>` CNAME `<host>.aoike.jp.<DCV Delegation の値>.dcv.cloudflare.com`（証明書の発行・更新を Cloudflare に任せる） |
| ラディックス（aoike.jp） | `_cf-custom-hostname.<host>` TXT（ホスト名の所有確認） |
| Cloudflare（chiji.tech） | SSL/TLS → Custom Hostnames に `<host>.aoike.jp`（最小 TLS 1.2、TXT Validation） |
| Cloudflare（chiji.tech） | fallback origin `fallback.chiji.tech`（AAAA `100::`、プロキシ有効）と `saas` CNAME `fallback.chiji.tech`（プロキシ有効） |
| このリポジトリ | `wrangler.jsonc` の `routes`：`app.aoike.jp/*`・`kintai.aoike.jp/*`・`csv.aoike.jp/*`（`zone_name: chiji.tech`） |

`_acme-challenge` と `_cf-custom-hostname` の値は Custom Hostnames の画面で確認できます。

### 自動デプロイ（Workers Builds）

`main` への push で Workers Builds がビルド・デプロイします。

Workers & Pages → Worker → 設定 → ビルド

| 項目 | 値 |
| --- | --- |
| リポジトリ | Chiji1108/aoike-app |
| ルートディレクトリ | （空欄＝リポジトリのルート） |
| ビルドコマンド | `bun run build` |
| デプロイコマンド | `bunx wrangler deploy` |
| 本番以外のブランチのビルド（Preview builds） | オフ（ブランチのビルドは Previews 機能として実行され、`wrangler preview` とプレビュー専用 D1 の `previews` 設定が必要になるため使わない） |
| ビルドの監視パス | なし（すべての変更でビルド） |
| ビルド変数 `BUN_VERSION` | `1.4.2`（手元の Bun と合わせる。既定の 1.2.15 は `bun.lock` を読めない） |

### パスワードの変更

- アプリ右上のメニュー →「パスワード変更」から変更できます（他端末をログアウトさせるかを選択可）
- パスワードを忘れた場合は `bun run set-password --remote` で再設定できます（全端末がログアウトされます）

## 設計メモ

### 認証

- Better Auth の Email & Password を使用。メールアドレスは `src/lib/constants.ts` の `OFFICE_ACCOUNT_EMAIL` に固定し、ログイン画面ではパスワードのみ入力
- `disableSignUp: true` で公開登録を無効化。アカウントは `scripts/set-password.ts` で作成
- ユーザーには役割（`role`）がある。今は事務所アカウント（`office`）だけで、SHARP 用の閲覧アカウントなどはあとから足す。事務所のデータのサーバー関数は `office` でないと使えない（`src/lib/constants.ts` の `USER_ROLES`、`src/server/middleware.ts`）
- パスワードハッシュは Workers の CPU 制限を考慮し、Web Crypto ネイティブの PBKDF2-SHA256（100,000回）を使用（`src/lib/password.ts`）
- ログイン試行は D1 を使ったレート制限（1分間に5回まで）
- サーバー関数は同一オリジンからの呼び出しのみ許可（`src/start.ts` の CSRF ミドルウェア）

### スキーマ変更時

```bash
bun run db:generate        # drizzle/<auth|kintai|csv|fit>/ にマイグレーションSQLを生成
bun run db:migrate         # ローカルに適用
bun run db:migrate:remote  # 本番に適用
```

## ディレクトリ構成（共通の部分）

ツールごとの部分は各ツールの説明にあります。

```
src/
  worker.ts                Worker の入口（TanStack Start ＋ 工事場所の調査の Workflow）
  start.ts                 古いホスト名からの転送・CSRF
  routes/
    login.tsx              ログイン
    _authed.tsx            ログイン必須レイアウト
    _authed/index.tsx      ポータル
    _authed/kintai/        勤怠
    _authed/csv.tsx, csv/  工事経歴書 CSV
    _authed/fit.tsx, fit/  FIT 申請
    api/auth/$.ts          Better Auth ハンドラー
    api/csv/               工事経歴書 CSV のファイル・チャット
  components/
    app-shell.tsx          ヘッダー（ツールごとのメニュー）
    ui/                    shadcn/ui（`bunx shadcn add` は base-nova の部品に `import { cn } from "cn"` を書き、`cn` の依存を足すので、`@/lib/utils` に直して依存は足さない）
  db/                      Drizzle スキーマ（auth-schema・kintai-schema・cases-schema・fit-schema）
  lib/auth.ts, constants.ts, legacy-host.ts  認証の設定・定数・古いホスト名の転送先
  server/middleware.ts     ログインと役割の確かめ
scripts/set-password.ts    共通パスワードの設定
scripts/icons/             アイコンを作る
drizzle/                   マイグレーション（auth・kintai・csv・fit）
docs/                      ツールごとの説明
```
