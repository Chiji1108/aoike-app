-- 全体ルールの初期値を整える。職員が直した項目（文が 0009 のあとの初期値のままでないもの）は触らない
-- 字数の縮め方: 業種の言葉を付けると工事名が長くなるので、工事名の縮め方（末尾の「に伴う〇〇工事」を残す）を足す
UPDATE `csv_rule_items` SET `text` = '字数を超えたときの縮め方の順: 空白を取る → 株式会社を㈱・有限会社を㈲ → 法人格を省く → それでも長ければ職員に聞く。工事名は末尾の「に伴う〇〇工事」を残し、前の部分を縮める。', `version` = `version` + 1, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `scope` = 'global' AND `text` = '字数を超えたときの縮め方の順: 空白を取る → 株式会社を㈱・有限会社を㈲ → 法人格を省く → それでも長ければ職員に聞く。';
--> statement-breakpoint
-- 工事名: 業種の言葉は決まった処理が付ける（AI には項目の説明で伝える）ので、ルールからは外す
UPDATE `csv_rule_items` SET `text` = '工事名は場所と内容が分かるようにする。', `version` = `version` + 1, `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE `scope` = 'global' AND `text` = '工事名は場所と内容が分かるようにする。業種の言葉（「〜に伴う管工事」）は業種が決まった行に決まった処理が付けるので、書き足さない。';
