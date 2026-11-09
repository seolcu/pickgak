-- 기본 이름(heroes.name, maps.name)은 넥슨 한국어. 다른 언어 이름은 여기에 둔다.
CREATE TABLE hero_names (
    hero_id TEXT NOT NULL,
    locale  TEXT NOT NULL,
    name    TEXT NOT NULL,
    PRIMARY KEY (hero_id, locale)
);
CREATE TABLE map_names (
    map_id TEXT NOT NULL,
    locale TEXT NOT NULL,
    name   TEXT NOT NULL,
    PRIMARY KEY (map_id, locale)
);
