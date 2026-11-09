//! Frames from a real 2560x1440 Quick Play recording, downscaled to 1280x720.
//!
//! The captures are real matches with players' names on them, so `tests/fixtures` is a git submodule of the
//! private `pickgak-fixtures` repository. Without it every test here passes as skipped.
use pickgak_vision::*;

macro_rules! fixtures_or_skip {
    () => {
        if !std::path::Path::new(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/fixtures/f_825.jpg"
        ))
        .exists()
        {
            eprintln!("skipped: tests/fixtures is not checked out (private submodule)");
            return;
        }
    };
}

fn load(name: &str) -> (Vec<u8>, usize, usize) {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let img = image::open(path).unwrap().to_rgba8();
    let (w, h) = img.dimensions();
    (img.into_raw(), w as usize, h as usize)
}

fn frame(name: &str) -> (Vec<u8>, usize, usize) {
    load(name)
}

#[test]
fn detects_scoreboards_and_rejects_lookalikes() {
    fixtures_or_skip!();
    for (name, expect) in [
        ("f_313.jpg", Some(5)), // early match, no perk columns yet
        ("f_619.jpg", Some(5)), // ult-ready rows glow blue left of the table
        ("f_825.jpg", Some(5)), // late match, perk columns shift the table left
        ("f_548.jpg", None),    // killcam
        ("f_850.5.jpg", None),  // play of the game
        ("f_452.5.jpg", None),  // gameplay
    ] {
        let (data, width, height) = frame(name);
        let f = Frame {
            data: &data,
            width,
            height,
        };
        let got = detect_scoreboard(&f);
        assert_eq!(
            got.as_ref().map(|l| l.team_rows(Team::Ally).len()),
            expect,
            "{name}"
        );
        if let Some(l) = got {
            assert_eq!(l.team_rows(Team::Enemy).len(), 5, "{name}");
        }
    }
}

#[test]
fn infers_row_positions_like_the_role_icons() {
    fixtures_or_skip!();
    // role icon centers measured on the 2560x1440 frame
    let (data, width, height) = frame("full_825.jpg");
    let l = detect_scoreboard(&Frame {
        data: &data,
        width,
        height,
    })
    .unwrap();
    let want = [
        293.0, 379.0, 467.0, 557.0, 646.0, 835.0, 923.0, 1012.0, 1100.0, 1188.0,
    ];
    for (row, w) in l.rows.iter().zip(want) {
        assert!((row.y - w).abs() <= 6.0, "row at {} vs icon {w}", row.y);
    }
}

#[test]
fn practice_range_has_its_own_layout() {
    fixtures_or_skip!();
    // 2560x1440 capture from the desktop app: 5 ally rows (4 waiting for players) and 1 red bot row,
    // lower on screen and with larger rows than a match
    let (data, width, height) = frame("range_2560.jpg");
    let f = Frame {
        data: &data,
        width,
        height,
    };
    let l = detect_scoreboard(&f).expect("range scoreboard");
    assert_eq!(
        (
            l.team_rows(Team::Ally).len(),
            l.team_rows(Team::Enemy).len()
        ),
        (5, 1)
    );
    assert!((l.rows[0].y - 503.0).abs() <= 6.0 && (l.rows[5].y - 978.0).abs() <= 6.0);
    assert_eq!(me_row(&f, &l), Some(0));
    let stats = pickgak_vision::stats::read_stats(&f, &l);
    assert_eq!(stats[0], [Some(0); 6]);
    assert_eq!(stats[5], [Some(0); 6]);
}

#[test]
fn finds_my_highlighted_row() {
    fixtures_or_skip!();
    for name in ["f_313.jpg", "f_619.jpg", "f_825.jpg"] {
        let (data, width, height) = frame(name);
        let f = Frame {
            data: &data,
            width,
            height,
        };
        let l = detect_scoreboard(&f).unwrap();
        assert_eq!(me_row(&f, &l), Some(1), "{name}");
    }
}

#[test]
fn same_portrait_art_matches_across_the_match() {
    fixtures_or_skip!();
    // Vendetta (my row 1) and Sombra (row 4) at 6:20 and at 14:45 into the recording
    let (a, w, h) = frame("f_619.jpg");
    let (b, _, _) = frame("f_825.jpg");
    let fa = Frame {
        data: &a,
        width: w,
        height: h,
    };
    let fb = Frame {
        data: &b,
        width: w,
        height: h,
    };
    let (la, lb) = (
        detect_scoreboard(&fa).unwrap(),
        detect_scoreboard(&fb).unwrap(),
    );
    let templates = vec![
        Template {
            label: "vendetta".into(),
            feat: portrait_feature(&fa, &la, 1),
        },
        Template {
            label: "sombra".into(),
            feat: portrait_feature(&fa, &la, 4),
        },
    ];
    assert_eq!(
        classify(&portrait_feature(&fb, &lb, 1), &templates)
            .label
            .as_deref(),
        Some("vendetta")
    );
    assert_eq!(
        classify(&portrait_feature(&fb, &lb, 4), &templates)
            .label
            .as_deref(),
        Some("sombra")
    );
    // an unseen enemy hero matches neither
    assert_eq!(
        classify(&portrait_feature(&fb, &lb, 6), &templates).label,
        None
    );
}

#[test]
fn rejects_duplicate_heroes_within_a_team() {
    fixtures_or_skip!();
    let (data, width, height) = frame("f_825.jpg");
    let layout = detect_scoreboard(&Frame {
        data: &data,
        width,
        height,
    })
    .unwrap();
    let m = |l: &str| Match {
        label: Some(l.into()),
        score: 0.9,
    };
    let mut rows: Vec<Match> = (0..10)
        .map(|_| Match {
            label: None,
            score: 0.0,
        })
        .collect();
    rows[1] = m("genji");
    rows[2] = m("genji");
    assert!(!sane(&Reading {
        layout: layout.clone(),
        rows: rows.clone(),
        me: None
    }));
    rows[2] = m("tracer");
    rows[6] = m("genji"); // mirror across teams is fine
    assert!(sane(&Reading {
        layout,
        rows,
        me: None
    }));
}

#[test]
fn reads_scoreboard_numbers_at_full_resolution() {
    fixtures_or_skip!();
    use pickgak_vision::stats::read_stats;
    let truth: [(&str, [[u32; 6]; 10]); 2] = [
        (
            "full_825.jpg",
            [
                [9, 1, 5, 8614, 907, 6864],
                [11, 2, 5, 5416, 85, 2043],
                [7, 1, 6, 8032, 0, 274],
                [2, 9, 3, 1173, 6373, 586],
                [8, 9, 6, 2847, 6275, 640],
                [8, 2, 4, 4373, 245, 7332],
                [8, 1, 3, 6744, 0, 279],
                [20, 0, 5, 9618, 0, 0],
                [3, 7, 2, 1892, 6362, 456],
                [8, 5, 4, 3344, 9540, 294],
            ],
        ),
        (
            "full_619.jpg",
            [
                [5, 0, 3, 4885, 907, 1536],
                [6, 0, 2, 4117, 0, 1018],
                [4, 1, 4, 4497, 0, 274],
                [0, 5, 1, 737, 4044, 586],
                [5, 6, 4, 1765, 3133, 585],
                [4, 1, 2, 2990, 0, 4984],
                [7, 1, 1, 4777, 0, 279],
                [11, 0, 3, 5387, 0, 0],
                [2, 3, 1, 1083, 4155, 403],
                [5, 2, 3, 1465, 5885, 225],
            ],
        ),
    ];
    for (name, want) in truth {
        let (data, width, height) = frame(name);
        let f = Frame {
            data: &data,
            width,
            height,
        };
        let l = detect_scoreboard(&f).expect("scoreboard");
        let got = read_stats(&f, &l);
        let mut wrong = vec![];
        for r in 0..10 {
            for c in 0..6 {
                if got[r][c] != Some(want[r][c]) {
                    wrong.push(format!(
                        "row {r} col {c}: {:?} != {}",
                        got[r][c], want[r][c]
                    ));
                }
            }
        }
        assert!(wrong.is_empty(), "{name}: {wrong:?}");
    }
}

#[test]
fn built_in_portraits_recognize_heroes_before_any_teaching() {
    fixtures_or_skip!();
    let (n, q, e, d) = (
        None,
        Some("__unknown__"),
        Some("__empty__"),
        Some("__dead__"),
    );
    let s = |h: &'static str| Some(h);
    for (name, want) in [
        (
            "f_825.jpg",
            vec![
                s("sigma"),
                s("vendetta"),
                s("hanzo"),
                s("kiriko"),
                s("sombra"),
                s("domina"),
                s("junkrat"),
                s("sierra"),
                s("ana"),
                s("lifeweaver"),
            ],
        ),
        (
            "full_825.jpg",
            vec![
                s("sigma"),
                s("vendetta"),
                s("hanzo"),
                s("kiriko"),
                s("sombra"),
                s("domina"),
                s("junkrat"),
                s("sierra"),
                s("ana"),
                s("lifeweaver"),
            ],
        ),
        // 1280x720; the last two enemies show respawn timers
        // the last enemy's respawn timer covers the middle; Lifeweaver is still recognized around it
        (
            "f_619.jpg",
            vec![
                s("sigma"),
                s("vendetta"),
                s("hanzo"),
                s("kiriko"),
                s("sombra"),
                s("dmon"),
                s("shion"),
                s("sierra"),
                n,
                s("lifeweaver"),
            ],
        ),
        (
            "full_619.jpg",
            vec![
                s("sigma"),
                s("vendetta"),
                s("hanzo"),
                s("kiriko"),
                s("sombra"),
                s("dmon"),
                s("shion"),
                s("sierra"),
                n,
                s("lifeweaver"),
            ],
        ),
        // early match: one ally and every enemy still "?"
        (
            "f_313.jpg",
            vec![
                s("junker-queen"),
                s("vendetta"),
                s("genji"),
                q,
                s("sombra"),
                q,
                q,
                q,
                q,
                q,
            ],
        ),
        // practice range: me (D.Mon), four rows waiting for players, the bot
        ("range_2560.jpg", vec![s("dmon"), e, e, e, e, s("tracer")]),
        // competitive 2026 scoreboard (VS between teams, ult charge next to the portrait)
        (
            "comp_full_2560.jpg",
            vec![
                s("doomfist"),
                s("pharah"),
                s("soldier-76"),
                s("zenyatta"),
                s("wuyang"),
                s("reinhardt"),
                s("junkrat"),
                s("tracer"),
                s("mercy"),
                s("jetpack-cat"),
            ],
        ),
        // skulls: the hero around it is read when clear enough (Zenyatta, Tracer), else it stays "dead"
        (
            "comp_dead_2560.jpg",
            vec![
                s("doomfist"),
                d,
                s("soldier-76"),
                s("zenyatta"),
                s("mercy"),
                s("reinhardt"),
                s("junkrat"),
                s("tracer"),
                s("mercy"),
                s("jetpack-cat"),
            ],
        ),
        // the header bar's first pixel row is only partly drawn here
        (
            "comp_header_edge_2560.jpg",
            vec![
                s("doomfist"),
                s("genji"),
                s("soldier-76"),
                s("zenyatta"),
                s("jetpack-cat"),
                s("reinhardt"),
                s("junkrat"),
                s("tracer"),
                s("mercy"),
                s("jetpack-cat"),
            ],
        ),
        // my highlighted row has a "ready" check over the portrait's right edge
        (
            "range_widow_2560.jpg",
            vec![s("widowmaker"), e, e, e, e, s("tracer")],
        ),
    ] {
        let (data, width, height) = frame(name);
        let r = read(
            &Frame {
                data: &data,
                width,
                height,
            },
            &[],
        )
        .expect(name);
        let got: Vec<Option<&str>> = r.rows.iter().map(|m| m.label.as_deref()).collect();
        assert_eq!(got, want, "{name}");
    }
}

#[test]
fn map_text_is_the_same_across_resolutions_and_differs_between_maps() {
    fixtures_or_skip!();
    use pickgak_vision::maptext::{map_text, similarity};
    let text = |name: &str| {
        let (data, width, height) = frame(name);
        map_text(&Frame {
            data: &data,
            width,
            height,
        })
        .expect(name)
    };
    // Colosseo early and late in the match (same resolution), and at 2560 vs 1280
    let (a, b, c) = (text("f_313.jpg"), text("full_825.jpg"), text("f_825.jpg"));
    assert!(similarity(&a, &c) > 0.98, "{}", similarity(&a, &c));
    assert!(similarity(&b, &c) > 0.9, "{}", similarity(&b, &c));
    // only the map name counts (right of "|"): Colosseo's name block is wider than tall by a fixed
    // ratio whatever mode text came before it
    assert!(
        (a.aspect - b.aspect).abs() < 0.3,
        "{} vs {}",
        a.aspect,
        b.aspect
    );
    // competitive Lijiang Tower is another map
    let l = text("comp_full_2560.jpg");
    assert!(similarity(&l, &b) < 0.9, "{}", similarity(&l, &b));
    assert!(similarity(&l, &text("comp_dead_2560.jpg")) > 0.98);
    // the practice range reads differently
    let r = text("range_2560.jpg");
    assert!(similarity(&r, &b) < 0.5, "{}", similarity(&r, &b));
    assert!(similarity(&r, &text("range_widow_2560.jpg")) > 0.9);
}

/// Top-right HUD of two 2560x1440 captures (the rest blacked out) where only 14 empty columns
/// separate the map name from "시간:". The block used to swallow "시간:" and the map went unread.
#[test]
fn map_text_stops_before_the_timer_label_on_a_narrow_gap() {
    fixtures_or_skip!();
    use pickgak_vision::maptext::map_text;
    for (name, timer_x) in [
        ("map_circuit_royal_2560.png", 2386),
        ("map_ilios_2560.png", 2374),
    ] {
        let (data, width, height) = frame(name);
        let t = map_text(&Frame {
            data: &data,
            width,
            height,
        })
        .expect(name);
        let end = t.full[0] + t.full[2];
        assert!(end + 10 < timer_x, "{name}: block ends at {end}");
        assert!(t.full[2] > 120, "{name}: block is {} wide", t.full[2]);
    }
}

#[test]
fn reads_banned_heroes_on_the_competitive_tab_screen() {
    fixtures_or_skip!();
    use pickgak_vision::bans::read_bans;
    let bans = |name: &str| {
        let (data, width, height) = frame(name);
        read_bans(&Frame {
            data: &data,
            width,
            height,
        })
        .into_iter()
        .map(|m| m.label)
        .collect::<Vec<_>>()
    };
    let want: Vec<Option<String>> = ["ana", "zarya", "winston", "kiriko", "sombra"]
        .iter()
        .map(|h| Some(h.to_string()))
        .collect();
    assert_eq!(bans("comp_full_2560.jpg"), want);
    assert_eq!(bans("comp_dead_2560.jpg"), want);
    // quick play and the practice range have no ban strip
    assert!(bans("full_825.jpg").is_empty());
    assert!(bans("range_2560.jpg").is_empty());
}

#[test]
fn reads_the_match_rank_range() {
    fixtures_or_skip!();
    use pickgak_vision::rank::read_rank_range;
    let ranks = |name: &str| {
        let (data, width, height) = frame(name);
        read_rank_range(&Frame {
            data: &data,
            width,
            height,
        })
        .into_iter()
        .map(|m| m.label)
        .collect::<Vec<_>>()
    };
    let bronze_silver = vec![Some("bronze".to_string()), Some("silver".to_string())];
    assert_eq!(ranks("comp_full_2560.jpg"), bronze_silver);
    assert_eq!(ranks("comp_dead_2560.jpg"), bronze_silver);
    // quick play, the practice range: no emblems
    for name in ["full_825.jpg", "f_825.jpg", "range_2560.jpg"] {
        assert!(ranks(name).is_empty(), "{name}");
    }
}

/// The fixture resized to `w`x`h` (other resolutions).
fn scaled(name: &str, w: u32, h: u32) -> (Vec<u8>, usize, usize) {
    let img = image::open(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    let img = img
        .resize_exact(w, h, image::imageops::FilterType::Triangle)
        .to_rgba8();
    (img.into_raw(), w as usize, h as usize)
}

/// The fixture centered on a wider black canvas (the scoreboard of a 21:9 screen sits in the middle).
fn pillarboxed(name: &str, w: u32) -> (Vec<u8>, usize, usize) {
    let img = image::open(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
    .to_rgba8();
    let mut out = image::RgbaImage::from_pixel(w, img.height(), image::Rgba([0, 0, 0, 255]));
    image::imageops::overlay(&mut out, &img, ((w - img.width()) / 2) as i64, 0);
    let h = out.height() as usize;
    (out.into_raw(), w as usize, h)
}

#[test]
fn reads_the_same_at_other_resolutions_and_widths() {
    fixtures_or_skip!();
    use pickgak_vision::{bans::read_bans, rank::read_rank_range};
    let labels = |v: Vec<Match>| v.into_iter().map(|m| m.label).collect::<Vec<_>>();
    let all = |(data, width, height): (Vec<u8>, usize, usize)| {
        let f = Frame {
            data: &data,
            width,
            height,
        };
        let r = read(&f, &[]).expect("scoreboard");
        (
            labels(r.rows),
            r.me,
            labels(read_bans(&f)),
            labels(read_rank_range(&f)),
        )
    };
    let base = all(frame("comp_full_2560.jpg"));
    assert_eq!(all(scaled("comp_full_2560.jpg", 3840, 2160)), base, "4K");
    assert_eq!(all(scaled("comp_full_2560.jpg", 1920, 1080)), base, "1080p");
    // 21:9: the table is centered; only the scoreboard rows are checked (the corner HUD layout of
    // ultrawide screens hasn't been seen yet)
    let (data, width, height) = pillarboxed("comp_full_2560.jpg", 3440);
    let r = read(
        &Frame {
            data: &data,
            width,
            height,
        },
        &[],
    )
    .expect("21:9");
    assert_eq!((labels(r.rows), r.me), (base.0.clone(), base.1));
}

#[test]
fn rejects_boards_with_more_than_six_rows_a_side() {
    fixtures_or_skip!();
    // the ally band of a 5v5 frame stretched over the enemy band: 10 blue rows in one team
    let (mut data, width, height) = frame("full_825.jpg");
    let f = Frame {
        data: &data,
        width,
        height,
    };
    let l = detect_scoreboard(&f).unwrap();
    let (ally0, enemy0) = (l.rows[0].y as usize, l.rows[5].y as usize);
    let shift = enemy0 - ally0;
    let rows_h = (l.row_h * 5.0) as usize;
    for y in (ally0 - (l.row_h / 2.0) as usize)..(ally0 - (l.row_h / 2.0) as usize + rows_h) {
        let (src, dst) = (y * width * 4, (y + shift) * width * 4);
        let row: Vec<u8> = data[src..src + width * 4].to_vec();
        data[dst..dst + width * 4].copy_from_slice(&row);
    }
    // close the "VS" gap so it reads as one band
    for y in (ally0 - (l.row_h / 2.0) as usize + rows_h)..(enemy0 - (l.row_h / 2.0) as usize) {
        let src = (ally0 * width) * 4;
        let row: Vec<u8> = data[src..src + width * 4].to_vec();
        data[y * width * 4..(y + 1) * width * 4].copy_from_slice(&row);
    }
    assert!(
        detect_scoreboard(&Frame {
            data: &data,
            width,
            height
        })
        .is_none()
    );
}

#[test]
fn name_glyphs_match_the_same_name_at_another_resolution() {
    fixtures_or_skip!();
    use image::imageops::FilterType;
    use pickgak_vision::nameplate::{name_of, similarity};

    let (data, width, height) = frame("full_825.jpg");
    let f = Frame {
        data: &data,
        width,
        height,
    };
    let l = detect_scoreboard(&f).expect("scoreboard");
    let names: Vec<_> = (0..l.rows.len())
        .map(|i| name_of(&f, &l, i).unwrap_or_else(|| panic!("row {i} has no name")))
        .collect();
    // different players on neighbouring rows are different glyphs (not just a common background)
    for i in 1..names.len() {
        let s = similarity(&names[0].feat, &names[i].feat);
        assert!(s < 0.5, "row 0 vs {i}: {s}");
    }

    // the same frame at 1920x1080 (the fixtures are a 2560x1440 recording)
    let img = image::RgbaImage::from_raw(width as u32, height as u32, data).unwrap();
    let small = image::imageops::resize(&img, 1920, 1080, FilterType::Lanczos3);
    let (w2, h2) = small.dimensions();
    let d2 = small.into_raw();
    let f2 = Frame {
        data: &d2,
        width: w2 as usize,
        height: h2 as usize,
    };
    let l2 = detect_scoreboard(&f2).expect("scoreboard at 1080p");
    let names2: Vec<_> = (0..l2.rows.len())
        .map(|i| name_of(&f2, &l2, i).unwrap_or_else(|| panic!("row {i} has no name at 1080p")))
        .collect();
    for (i, want) in names.iter().enumerate() {
        let s = similarity(&want.feat, &names2[i].feat);
        let other = names2
            .iter()
            .enumerate()
            .filter(|(j, _)| *j != i)
            .map(|(_, n)| similarity(&want.feat, &n.feat))
            .fold(0f32, f32::max);
        eprintln!(
            "row {i}: {:?} vs {:?} = {s} (other {other})",
            want.rect, names2[i].rect
        );
        // Same name at 1080p still leads every other name by a wide margin, even though a resolution
        // change drops it below the automatic bar (it asks once more instead).
        assert!(s > 0.45, "row {i}: {s}");
        assert!(s > other + 0.15, "row {i}: {s} vs {other}");
    }
}

#[test]
fn reads_names_and_strips_nameplates_on_the_app_capture() {
    fixtures_or_skip!();
    use pickgak_vision::nameplate::{name_of, similarity};

    // 2560x1440 capture from the app itself: two party rows, a level nameplate and a
    // name with a title line under it.
    let (data, width, height) = frame("names_2560.jpg");
    let f = Frame {
        data: &data,
        width,
        height,
    };
    let l = detect_scoreboard(&f).expect("scoreboard");
    let party = party_rows(&f, &l);
    assert!(party[0] && party[1], "party flags {party:?}");
    assert!(party[2..].iter().all(|p| !p), "party flags {party:?}");
    // the highlighted row is the second party row; the nameplate/white name of the other must not win
    assert_eq!(me_row(&f, &l), Some(1));

    let names: Vec<_> = (0..l.rows.len())
        .map(|i| name_of(&f, &l, i).unwrap_or_else(|| panic!("row {i} has no name")))
        .collect();
    // the level emblem and colored plate are not part of the glyph box
    assert!(names[5].rect[2] < 180, "nameplate row {:?}", names[5].rect);
    assert!(similarity(&names[0].feat, &names[5].feat) < 0.5);
    // the dim title line under the name is excluded (the name band is 33 px tall here)
    assert!(names[3].rect[3] <= 36, "title row {:?}", names[3].rect);
}

#[test]
fn name_glyphs_ignore_the_ult_circle_and_a_fading_scoreboard() {
    fixtures_or_skip!();
    use pickgak_vision::nameplate::{NAME_MIN, name_of, similarity};

    // Three captures of one match (2560x1440). Party rows 0 and 1; on the second capture row 0 has its
    // ult ready, and the check mark circle left of the name is as bright as the glyphs. The third was
    // taken while the scoreboard faded in, so the glyphs are dimmer.
    let read = |file: &str| {
        let (data, width, height) = frame(file);
        let f = Frame {
            data: &data,
            width,
            height,
        };
        let l = detect_scoreboard(&f).expect("scoreboard");
        assert!(party_rows(&f, &l)[..2].iter().all(|p| *p), "{file}");
        (name_of(&f, &l, 0), name_of(&f, &l, 1))
    };
    let (a0, a1) = read("names_settled_2560.jpg");
    let (a0, a1) = (a0.expect("row 0"), a1.expect("row 1"));
    let (u0, u1) = read("names_ult_2560.jpg");
    let (u0, u1) = (u0.expect("row 0 with ult"), u1.expect("row 1"));
    // the glyph box starts at the name, not at the circle (it measured 27 px wider with the circle)
    assert_eq!(u0.rect[0], a0.rect[0], "{:?} vs {:?}", u0.rect, a0.rect);
    let s = similarity(&a0.feat, &u0.feat);
    assert!(s >= NAME_MIN, "ult row: {s}");
    assert!(similarity(&a1.feat, &u1.feat) >= NAME_MIN);
    assert!(similarity(&a0.feat, &a1.feat) < 0.3);

    // a fading frame leaves the names unread instead of a different fingerprint (it scored 0.55)
    let (f0, f1) = read("names_fading_2560.jpg");
    assert!(f0.is_none() && f1.is_none());
}
