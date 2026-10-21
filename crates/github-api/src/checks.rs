//! Cached, batched check summaries for many commits (PR badges, check dots on branch tips).

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use futures_util::StreamExt;
use futures_util::stream;
use tokio::time::Instant;

use crate::client::GitHub;
use crate::error::Error;
use crate::http::Transport;
use crate::pulls::{ChecksSummary, checks_for};
use crate::repos::RepoSlug;

/// Requests in flight at once when filling cache misses.
const CONCURRENCY: usize = 4;

type Key = (String, String);
type Entries = HashMap<Key, (Instant, ChecksSummary)>;

/// Per-(slug, sha) cache of check summaries with a TTL; a sha that is still pending expires faster.
pub struct ChecksCache {
    ttl: Duration,
    pending_ttl: Duration,
    map: Mutex<Entries>,
}

impl ChecksCache {
    /// New empty cache. The app uses 120 s / 20 s.
    pub fn new(ttl: Duration, pending_ttl: Duration) -> Self {
        Self { ttl, pending_ttl, map: Mutex::new(HashMap::new()) }
    }

    fn map(&self) -> MutexGuard<'_, Entries> {
        self.map.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Summaries for `shas` (deduplicated), served from the cache unless expired or `force`.
    /// Misses are fetched with at most 4 requests in flight. A sha whose fetch fails is logged
    /// and omitted; the others still return.
    ///
    /// # Errors
    /// [`Error::Unauthorized`] and [`Error::RateLimited`] abort the whole call.
    pub async fn get_many<T: Transport>(
        &self,
        gh: &GitHub<T>,
        token: &str,
        slug: &RepoSlug,
        shas: &[String],
        force: bool,
    ) -> Result<HashMap<String, ChecksSummary>, Error> {
        let repo = format!("{}/{}", slug.owner, slug.name);
        let mut out = HashMap::new();
        let mut misses = Vec::new();
        let mut seen = HashSet::new();
        {
            let map = self.map();
            let now = Instant::now();
            for sha in shas.iter().filter(|s| seen.insert(s.as_str())) {
                let hit = map
                    .get(&(repo.clone(), sha.clone()))
                    .filter(|(at, s)| {
                        let ttl = if s.overall == "pending" { self.pending_ttl } else { self.ttl };
                        !force && now.saturating_duration_since(*at) < ttl
                    })
                    .map(|(_, s)| s.clone());
                match hit {
                    Some(s) => {
                        out.insert(sha.clone(), s);
                    }
                    None => misses.push(sha.clone()),
                }
            }
        }
        let mut fetched = stream::iter(misses)
            .map(|sha| async move {
                let r = checks_for(gh, token, slug, &sha).await;
                (sha, r)
            })
            .buffer_unordered(CONCURRENCY);
        while let Some((sha, res)) = fetched.next().await {
            match res {
                Ok(s) => {
                    self.map().insert((repo.clone(), sha.clone()), (Instant::now(), s.clone()));
                    out.insert(sha, s);
                }
                Err(e @ (Error::Unauthorized | Error::RateLimited { .. })) => return Err(e),
                Err(e) => tracing::debug!(%sha, error = %e, "checks fetch failed"),
            }
        }
        Ok(out)
    }

    /// Drops every cached summary (sign-out).
    pub fn clear(&self) {
        self.map().clear();
    }
}
