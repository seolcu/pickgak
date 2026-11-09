-- 부계정 닉네임: 한 사람이 게임 닉네임을 여러 개 쓸 수 있다 (JSON 배열)
ALTER TABLE players ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
