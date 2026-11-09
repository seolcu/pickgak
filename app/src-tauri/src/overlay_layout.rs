//! Physical-pixel placement beside the detected scoreboard, independent of desktop DPI.

#[derive(Debug, PartialEq)]
pub struct Placement {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub scale: f64,
}

/// The panel's content is laid out for this width at 1080p; narrower margins zoom it out.
const CONTENT_WIDTH: f64 = 248.0;
/// Widest panel at 1080p. The scoreboard edge moves with the match state (2560x1440 captures,
/// scaled to 1080p): x=290 in a match, x=551 before it starts (no hero panel on the right). The
/// pre-match margin leaves 518 for the panel; this cap only stops 21:9 margins from stretching it.
const MAX_WIDTH: f64 = 520.0;

pub fn beside_scoreboard(height: u32, table_left: u32) -> Option<Placement> {
    let scale = height as f64 / 1080.0;
    let x = (20.0 * scale).round() as u32;
    // The tab bar (hero info, scoreboard, bans) ends at y=80 at 1080p; start just below it.
    let y = (88.0 * scale).round() as u32;
    // Leave 13px before the detected scoreboard edge and fill the rest of the margin.
    let gap = (13.0 * scale).round().max(1.0) as u32;
    let available = table_left.checked_sub(x + gap)?;
    let width = available.min((MAX_WIDTH * scale).round() as u32);
    if width == 0 {
        return None;
    }
    Some(Placement {
        x,
        y,
        width,
        scale: scale.min(width as f64 / CONTENT_WIDTH),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_the_margin_up_to_the_measured_gutter() {
        // In a match (281 at 1920x1080, 387 at 2560x1440) and before it (735 at 2560x1440).
        for (height, left) in [(1080, 281), (2160, 562), (1440, 387), (1440, 735)] {
            let p = beside_scoreboard(height, left).unwrap();
            let scale = height as f64 / 1080.0;
            assert_eq!(p.scale, scale);
            assert_eq!(p.y, (88.0 * scale).round() as u32);
            assert_eq!(left - p.x - p.width, (13.0 * scale).round() as u32);
        }
    }

    #[test]
    fn caps_a_wide_margin() {
        let p = beside_scoreboard(1440, 1400).unwrap();
        assert_eq!(p.width, 693);
        assert_eq!(p.scale, 1440.0 / 1080.0);
    }

    #[test]
    fn fits_a_narrower_margin_without_clipping_the_content() {
        let p = beside_scoreboard(1200, 205).unwrap();
        assert!(p.x + p.width < 205);
        assert!(p.scale < 1200.0 / 1080.0);
        assert!((p.width as f64 / p.scale - CONTENT_WIDTH).abs() < 0.01);
        assert_eq!(beside_scoreboard(1080, 20), None);
    }
}
