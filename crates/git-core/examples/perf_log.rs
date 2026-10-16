//! Measures log paging + lane layout on a real repository (PLAN item 1.10).
//!
//! `cargo run -p git-core --release --example perf_log -- <repo-path>`
#![allow(clippy::print_stdout, clippy::unwrap_used, clippy::cast_precision_loss)]

use std::path::PathBuf;
use std::time::Instant;

use git_core::GitRunner;
use git_core::graph::LayoutState;
use git_core::parse::log::{CHUNK, FIRST_PAGE, LogQuery, log_page};
use git_core::parse::refs::list_refs;
use git_core::parse::status::status;

#[tokio::main]
async fn main() {
    let repo =
        PathBuf::from(std::env::args().nth(1).expect("usage: perf_log <repo-path> [single]"));
    // `single`: fetch everything after the first page in one git call instead of 10k chunks.
    let single = std::env::args().nth(2).as_deref() == Some("single");
    let runner = GitRunner::from_env();

    let t = Instant::now();
    let refs = list_refs(&runner, &repo).await.unwrap();
    println!("refs: {} in {:?}", refs.refs.len(), t.elapsed());

    let t = Instant::now();
    let st = status(&runner, &repo).await.unwrap();
    println!("status: {} entries in {:?}", st.entries.len(), t.elapsed());

    let mut layout = LayoutState::new();
    let mut skip = 0;
    let mut limit = FIRST_PAGE;
    let mut total = 0;
    let mut max_lanes = 0;
    let start = Instant::now();
    loop {
        let t = Instant::now();
        let page = log_page(&runner, &repo, &LogQuery { skip, limit, ..LogQuery::default() })
            .await
            .unwrap();
        let git_ms = t.elapsed().as_secs_f64() * 1e3;
        let t = Instant::now();
        let rows = layout.push_all(&page.commits);
        let lay_ms = t.elapsed().as_secs_f64() * 1e3;
        max_lanes = max_lanes.max(layout.active_lanes());
        total += rows.len();
        println!(
            "page skip={skip:>6} rows={:>6}  git+parse {git_ms:>7.1} ms  layout {lay_ms:>6.1} ms  lanes {}",
            rows.len(),
            layout.active_lanes()
        );
        if !page.has_more {
            break;
        }
        skip += page.commits.len();
        limit = if single { 1_000_000_000 } else { CHUNK };
    }
    println!("total: {total} commits in {:?}, max active lanes {max_lanes}", start.elapsed());
}
