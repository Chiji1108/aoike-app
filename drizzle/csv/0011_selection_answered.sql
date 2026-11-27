-- 保存した作業（csv_case_states.json）を、載せる工事に答えたか（selectionAnswered）を必ず持つ形にそろえる（リリースの前に一度だけ。何度当てても同じ）。
-- 当てるのは selectionAnswered を持たない作業だけ（json_type が NULL＝項目が無い）:
-- - selection: 前の形の alreadyApplied（true＝全件・false＝7割）を選び方に直す。どちらも無ければ7割ルール
-- - selectionAnswered: 選び方が全件（既定値ではないので職員が選んだ）か、途中の形の selectionBy が staff なら答えた（true）、ほかは false（「答える」で聞く）
-- - alreadyApplied・selectionBy を消し、取り消しの記録（undo）を空にする（前の版の記録は今の形では読めない）
-- version を1つ上げるので、移行の前から開いていた画面の保存はぶつかり、再読み込みを求められる（前の形で上書きしない）
UPDATE `csv_case_states`
SET
  `json` = json_set(
    json_remove(`json`, '$.alreadyApplied', '$.selectionBy'),
    '$.selection', CASE
      WHEN json_extract(`json`, '$.selection') IN ('rule7', 'all') THEN json_extract(`json`, '$.selection')
      WHEN json_extract(`json`, '$.alreadyApplied') = 1 THEN 'all'
      ELSE 'rule7'
    END,
    '$.selectionAnswered', CASE
      WHEN json_extract(`json`, '$.selectionBy') = 'staff' THEN json('true')
      WHEN json_extract(`json`, '$.selection') = 'all' THEN json('true')
      WHEN json_extract(`json`, '$.selection') IS NULL AND json_extract(`json`, '$.alreadyApplied') = 1 THEN json('true')
      ELSE json('false')
    END,
    '$.undo', json('[]')
  ),
  `version` = `version` + 1,
  `updated_at` = cast(unixepoch('subsecond') * 1000 as integer)
WHERE json_valid(`json`) AND json_type(`json`, '$.selectionAnswered') IS NULL;
