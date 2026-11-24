//! Parses conflict markers in a work-tree file into text and conflict chunks, and composes the
//! file again from per-chunk choices. Lines keep their own terminators, so line endings, a
//! missing final newline and a byte-order mark survive unchanged.

use serde::{Deserialize, Serialize};

const MARKER_LENGTH: usize = 7;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Segment {
    Text {
        lines: Vec<String>,
    },
    Conflict {
        ours_label: String,
        /// Present when `merge.conflictStyle` is `diff3` or `zdiff3`.
        base_label: Option<String>,
        theirs_label: String,
        ours: Vec<String>,
        base: Option<Vec<String>>,
        theirs: Vec<String>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChunkChoice {
    Ours,
    Theirs,
    OursThenTheirs,
    TheirsThenOurs,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Marker {
    Open,
    Base,
    Separator,
    Close,
}

/// Which marker a line is, if any, and the label after it.
fn marker(line: &str) -> Option<(Marker, String)> {
    let body = line.trim_end_matches(['\n', '\r']);
    let kinds = [
        ('<', Marker::Open),
        ('|', Marker::Base),
        ('=', Marker::Separator),
        ('>', Marker::Close),
    ];
    let (character, kind) = kinds.into_iter().find(|(c, _)| body.starts_with(*c))?;
    let run = body.chars().take_while(|c| *c == character).count();
    if run != MARKER_LENGTH {
        return None;
    }
    let rest = &body[MARKER_LENGTH..];
    match kind {
        Marker::Separator if rest.is_empty() => Some((kind, String::new())),
        Marker::Separator => None,
        _ if rest.is_empty() => Some((kind, String::new())),
        _ => rest
            .strip_prefix(' ')
            .map(|label| (kind, label.to_string())),
    }
}

#[derive(Default)]
struct Chunk {
    ours_label: String,
    base_label: Option<String>,
    ours: Vec<String>,
    base: Option<Vec<String>>,
    theirs: Vec<String>,
    section: u8,
}

const OURS: u8 = 0;
const BASE: u8 = 1;
const THEIRS: u8 = 2;

/// Splits a file into segments. `base_markers` says whether the conflict style writes a base
/// section (`diff3`, `zdiff3`). Nested, unbalanced or ambiguous markers are an error with a
/// reason for the user: the file must then be resolved by hand. A `|||||||` line in a two-way
/// conflict is ambiguous (content, or a base written by another style), so it is refused.
pub fn parse(text: &str, base_markers: bool) -> Result<Vec<Segment>, String> {
    let mut segments: Vec<Segment> = Vec::new();
    let mut plain: Vec<String> = Vec::new();
    let mut open: Option<Chunk> = None;
    for (number, line) in text.split_inclusive('\n').enumerate() {
        let found = marker(line);
        let Some(chunk) = open.as_mut() else {
            match found {
                Some((Marker::Open, label)) => {
                    if !plain.is_empty() {
                        segments.push(Segment::Text {
                            lines: std::mem::take(&mut plain),
                        });
                    }
                    open = Some(Chunk {
                        ours_label: label,
                        ..Chunk::default()
                    });
                }
                Some((Marker::Close, _)) => {
                    return Err(format!(
                        "Line {}: a closing marker has no opening marker.",
                        number + 1
                    ))
                }
                _ => plain.push(line.to_string()),
            }
            continue;
        };
        match (found, chunk.section) {
            (None, OURS) => chunk.ours.push(line.to_string()),
            (None, BASE) => chunk
                .base
                .get_or_insert_with(Vec::new)
                .push(line.to_string()),
            (None, _) => chunk.theirs.push(line.to_string()),
            (Some((Marker::Base, _)), OURS) if !base_markers => {
                return Err(format!(
                    "Line {}: a base marker in a two-way conflict is ambiguous.",
                    number + 1
                ))
            }
            (Some((Marker::Base, label)), OURS) => {
                chunk.base_label = Some(label);
                chunk.base = Some(Vec::new());
                chunk.section = BASE;
            }
            (Some((Marker::Separator, _)), OURS | BASE) => chunk.section = THEIRS,
            (Some((Marker::Close, label)), THEIRS) => {
                let done = open.take().unwrap_or_default();
                segments.push(Segment::Conflict {
                    ours_label: done.ours_label,
                    base_label: done.base_label,
                    theirs_label: label,
                    ours: done.ours,
                    base: done.base,
                    theirs: done.theirs,
                });
            }
            (Some((kind, _)), _) => {
                return Err(format!(
                    "Line {}: unexpected {} inside a conflict.",
                    number + 1,
                    describe(kind)
                ))
            }
        }
    }
    if open.is_some() {
        return Err("A conflict is not closed before the end of the file.".to_string());
    }
    if !plain.is_empty() {
        segments.push(Segment::Text { lines: plain });
    }
    Ok(segments)
}

fn describe(kind: Marker) -> &'static str {
    match kind {
        Marker::Open => "opening marker (nested conflict)",
        Marker::Base => "base marker",
        Marker::Separator => "second separator",
        Marker::Close => "closing marker",
    }
}

pub fn conflict_count(segments: &[Segment]) -> usize {
    segments
        .iter()
        .filter(|s| matches!(s, Segment::Conflict { .. }))
        .count()
}

/// The file with each conflict replaced by its choice. Fails unless every conflict has one.
pub fn compose(segments: &[Segment], choices: &[ChunkChoice]) -> Result<String, String> {
    if choices.len() != conflict_count(segments) {
        return Err("Choose a side for every conflict first.".to_string());
    }
    let empty: Vec<String> = Vec::new();
    let mut remaining = choices.iter();
    let mut output = String::new();
    for segment in segments {
        let (first, second) = match segment {
            Segment::Text { lines } => (lines, &empty),
            Segment::Conflict { ours, theirs, .. } => match remaining.next() {
                Some(ChunkChoice::Ours) => (ours, &empty),
                Some(ChunkChoice::Theirs) => (theirs, &empty),
                Some(ChunkChoice::OursThenTheirs) => (ours, theirs),
                Some(ChunkChoice::TheirsThenOurs) => (theirs, ours),
                None => return Err("Choose a side for every conflict first.".to_string()),
            },
        };
        first
            .iter()
            .chain(second)
            .for_each(|line| output.push_str(line));
    }
    Ok(output)
}

/// True when a line looks like an opening or closing conflict marker.
pub fn has_markers(text: &str) -> bool {
    text.split_inclusive('\n')
        .any(|line| matches!(marker(line), Some((Marker::Open | Marker::Close, _))))
}

/// FNV-1a over the bytes, with the length, as hex. Detects edits made after the file was shown.
pub fn fingerprint(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(0xcbf2_9ce4_8422_2325_u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3)
    });
    format!("{hash:016x}-{}", bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ChunkChoice::*;

    const MERGE: &str =
        "top\n<<<<<<< HEAD\nours 1\nours 2\n=======\ntheirs\n>>>>>>> feature/login\nbottom";

    #[test]
    fn parses_two_way_conflicts_and_keeps_text() {
        let segments = parse(MERGE, false).unwrap();
        assert_eq!(segments.len(), 3);
        let Segment::Conflict {
            ours_label,
            theirs_label,
            ours,
            theirs,
            base,
            ..
        } = &segments[1]
        else {
            panic!("expected a conflict")
        };
        assert_eq!(
            (ours_label.as_str(), theirs_label.as_str()),
            ("HEAD", "feature/login")
        );
        assert_eq!(ours, &vec!["ours 1\n", "ours 2\n"]);
        assert_eq!(theirs, &vec!["theirs\n"]);
        assert!(base.is_none());
        assert_eq!(
            compose(&segments, &[Ours]).unwrap(),
            "top\nours 1\nours 2\nbottom"
        );
        assert_eq!(
            compose(&segments, &[TheirsThenOurs]).unwrap(),
            "top\ntheirs\nours 1\nours 2\nbottom"
        );
        assert!(compose(&segments, &[]).is_err());
    }

    #[test]
    fn parses_diff3_base_and_keeps_crlf() {
        let text =
            "a\r\n<<<<<<< ours\r\nx\r\n||||||| base\r\no\r\n=======\r\ny\r\n>>>>>>> theirs\r\n";
        let segments = parse(text, true).unwrap();
        let Segment::Conflict {
            base_label, base, ..
        } = &segments[1]
        else {
            panic!()
        };
        assert_eq!(base_label.as_deref(), Some("base"));
        assert_eq!(base.as_deref(), Some(&["o\r\n".to_string()][..]));
        assert_eq!(
            compose(&segments, &[OursThenTheirs]).unwrap(),
            "a\r\nx\r\ny\r\n"
        );
    }

    #[test]
    fn refuses_broken_markers() {
        assert!(parse("<<<<<<< a\nx\n<<<<<<< b\n", false).is_err(), "nested");
        assert!(
            parse("<<<<<<< a\nx\n=======\ny\n", false).is_err(),
            "unterminated"
        );
        assert!(parse("x\n>>>>>>> b\n", false).is_err(), "stray close");
        assert!(
            parse("<<<<<<< a\nx\n=======\ny\n=======\nz\n>>>>>>> b\n", false).is_err(),
            "ambiguous"
        );
        let two_way = "<<<<<<< a\nx\n||||||| b\ny\n=======\nz\n>>>>>>> c\n";
        assert!(
            parse(two_way, false).is_err(),
            "a base marker in a two-way conflict is ambiguous"
        );
        assert!(parse(two_way, true).is_ok());
        // Separators and longer runs outside a conflict are ordinary text.
        assert_eq!(parse("Title\n=======\n<<<<<<<<\n", false).unwrap().len(), 1);
        assert!(has_markers(MERGE));
        assert!(!has_markers("=======\n"));
    }

    #[test]
    fn fingerprints_change_with_content() {
        assert_ne!(fingerprint(b"a"), fingerprint(b"b"));
        assert_eq!(fingerprint(b"a"), fingerprint(b"a"));
    }
}
