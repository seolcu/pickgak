-- 이 사람은 선호 영웅만 한다 (파티 추천에서 그 사람에게는 선호 영웅만 추천)
ALTER TABLE players ADD COLUMN only_preferred INTEGER NOT NULL DEFAULT 0;
