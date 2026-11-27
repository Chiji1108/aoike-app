-- 開発者への要望と、工事場所の覚えた結果をやめたので、そのテーブルを消す。デプロイのあとに当てる（前のコードはこのテーブルを読み書きする）
DROP TABLE `csv_feedback`;--> statement-breakpoint
DROP TABLE `csv_location_memory`;
