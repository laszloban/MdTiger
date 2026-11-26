//! NFR-11: errors go to a log file, never to a dialog.
//!
//! One line per entry: `2026-11-25T10:00:00.123Z INFO message`. When the file
//! passes 1 MB it is renamed to `mdtiger.1.log` (one backup is kept).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const LOG_NAME: &str = "mdtiger.log";
const BACKUP_NAME: &str = "mdtiger.1.log";
const MAX_BYTES: u64 = 1_000_000;

pub struct Logger {
    dir: PathBuf,
    max_bytes: u64,
    lock: Mutex<()>,
}

impl Logger {
    pub fn new(dir: PathBuf, max_bytes: u64) -> Self {
        Logger { dir, max_bytes, lock: Mutex::new(()) }
    }

    pub fn write(&self, level: &str, message: &str) {
        let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        let _ = fs::create_dir_all(&self.dir);
        let path = self.dir.join(LOG_NAME);
        if fs::metadata(&path).map(|m| m.len() > self.max_bytes).unwrap_or(false) {
            let backup = self.dir.join(BACKUP_NAME);
            let _ = fs::remove_file(&backup);
            let _ = fs::rename(&path, &backup);
        }
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
            let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
            let _ = writeln!(f, "{} {} {}", iso_timestamp(ms), normalize_level(level), one_line(message));
        }
    }
}

fn normalize_level(level: &str) -> &'static str {
    match level.to_ascii_lowercase().as_str() {
        "warn" | "warning" => "WARN",
        "error" => "ERROR",
        _ => "INFO",
    }
}

/// Keeps one entry on one line.
fn one_line(message: &str) -> String {
    message.replace("\r\n", " | ").replace(['\r', '\n'], " | ")
}

/// Milliseconds since the Unix epoch as `YYYY-MM-DDTHH:MM:SS.mmmZ` (UTC).
pub fn iso_timestamp(ms: u128) -> String {
    let millis = (ms % 1000) as u32;
    let secs = (ms / 1000) as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    // Civil-from-days (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

static LOGGER: OnceLock<Logger> = OnceLock::new();

/// Call once at startup. Before this, `log` does nothing.
pub fn init(dir: PathBuf) {
    let _ = LOGGER.set(Logger::new(dir, MAX_BYTES));
}

pub fn log(level: &str, message: &str) {
    if let Some(l) = LOGGER.get() {
        l.write(level, message);
    }
}

pub fn info(message: &str) {
    log("info", message);
}

pub fn warn(message: &str) {
    log("warn", message);
}

pub fn error(message: &str) {
    log("error", message);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_format() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00.000Z");
        // 2026-11-25T10:00:00.123Z
        assert_eq!(iso_timestamp(1_795_600_800_123), "2026-11-25T10:00:00.123Z");
        // Leap day.
        assert_eq!(iso_timestamp(951_782_400_000), "2000-02-29T00:00:00.000Z");
    }

    #[test]
    fn writes_one_line_per_entry() {
        let dir = tempfile::tempdir().unwrap();
        let logger = Logger::new(dir.path().to_path_buf(), MAX_BYTES);
        logger.write("info", "hello");
        logger.write("warning", "two\nlines");
        let text = fs::read_to_string(dir.path().join(LOG_NAME)).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("Z INFO hello"));
        assert!(lines[1].ends_with("Z WARN two | lines"));
    }

    #[test]
    fn rotates_past_the_size_limit_and_keeps_one_backup() {
        let dir = tempfile::tempdir().unwrap();
        let logger = Logger::new(dir.path().to_path_buf(), 200);
        for i in 0..20 {
            logger.write("info", &format!("entry number {i} with some padding text"));
        }
        assert!(dir.path().join(BACKUP_NAME).exists());
        assert!(dir.path().join(LOG_NAME).exists());
        assert!(!dir.path().join("mdtiger.2.log").exists());
        let current = fs::read_to_string(dir.path().join(LOG_NAME)).unwrap();
        assert!(current.contains("entry number 19"));
    }
}
