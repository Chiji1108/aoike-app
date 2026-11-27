-- 案件を終えるときの振り返り（由来 review）をやめたので、振り返りから足したルールの項目はチャットから足したもの（chat）にする（何度当てても同じ）
UPDATE `csv_rule_items` SET `source` = 'chat' WHERE `source` = 'review';
