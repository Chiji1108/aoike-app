-- 保存した作業（csv_case_states.json）を、載せる工事の出どころ（selectionBy）を必ず持つ形にそろえる（リリースの前に一度だけ。何度当てても同じ）。
-- 当てるのは selectionBy を持たない作業だけ（json_type が NULL＝項目が無い。今の形の null は 'null' なので当てない）:
-- - selection: 前の形の alreadyApplied（true＝全件・false＝7割）を選び方に直す。どちらも無ければ7割ルール
-- - selectionBy: 選び方が全件なら職員が決めた値（staff）、ほかは誰も決めていない（null。「答える」で聞く）
-- - alreadyApplied を消し、取り消しの記録（undo）を空にする（前の版の記録は値だけで、今の形では読めない）
-- version を1つ上げるので、移行の前から開いていた画面の保存はぶつかり、再読み込みを求められる（前の形で上書きしない）
UPDATE `csv_case_states`
SET
  `json` = json_set(
    json_remove(`json`, '$.alreadyApplied'),
    '$.selection', CASE
      WHEN json_extract(`json`, '$.selection') IN ('rule7', 'all') THEN json_extract(`json`, '$.selection')
      WHEN json_extract(`json`, '$.alreadyApplied') = 1 THEN 'all'
      ELSE 'rule7'
    END,
    '$.selectionBy', CASE
      WHEN json_extract(`json`, '$.selection') = 'all' THEN 'staff'
      WHEN json_extract(`json`, '$.selection') IS NULL AND json_extract(`json`, '$.alreadyApplied') = 1 THEN 'staff'
      ELSE NULL
    END,
    '$.undo', json('[]')
  ),
  `version` = `version` + 1,
  `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE json_type(`json`, '$.selectionBy') IS NULL;
