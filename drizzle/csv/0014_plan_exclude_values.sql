-- 保存した作業（csv_case_states.json）を今の形にそろえる（リリースの前に一度だけ。何度当てても同じ）:
-- - 計画の出さない行の値（plan.plan.rowFilter.excludeValues）と聞き返し（plan.plan.asks）を必ず持つ（無ければ空の並び）
-- - やめた「全件にしますか？」を閉じた印（allHintClosed）を消す
-- version を1つ上げるので、移行の前から開いていた画面の保存はぶつかり、再読み込みを求められる
UPDATE `csv_case_states`
SET
  `json` = json_remove(
    CASE
      WHEN json_type(`json`, '$.plan.plan') = 'object' THEN json_set(
        `json`,
        '$.plan.plan.rowFilter.excludeValues', COALESCE(json_extract(`json`, '$.plan.plan.rowFilter.excludeValues'), json('[]')),
        '$.plan.plan.asks', COALESCE(json_extract(`json`, '$.plan.plan.asks'), json('[]'))
      )
      ELSE `json`
    END,
    '$.allHintClosed'
  ),
  `version` = `version` + 1
WHERE json_valid(`json`)
  AND (
    (json_type(`json`, '$.plan.plan') = 'object' AND (json_type(`json`, '$.plan.plan.rowFilter.excludeValues') IS NULL OR json_type(`json`, '$.plan.plan.asks') IS NULL))
    OR json_type(`json`, '$.allHintClosed') IS NOT NULL
  );
