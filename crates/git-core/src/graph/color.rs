//! Palette allocation for graph lanes.

/// Number of colors in the lane palette.
pub const PALETTE_SIZE: u8 = 12;

const N: usize = PALETTE_SIZE as usize;

/// Hands out palette indices, preferring colors not used by any active lane and,
/// among those, the least recently handed out.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ColorAllocator {
    in_use: [u32; N],
    last_used: [u64; N],
    tick: u64,
}

impl ColorAllocator {
    /// Create an allocator with every color free.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Allocate a color: the least-recently-used among colors not currently active;
    /// if all are active, the least-recently-used overall (it is then shared).
    pub fn alloc(&mut self) -> u8 {
        let mut best = 0u8;
        let mut best_key = (u32::MAX, u64::MAX);
        for i in 0..PALETTE_SIZE {
            let idx = usize::from(i);
            let key = (u32::from(self.in_use[idx] > 0), self.last_used[idx]);
            if key < best_key {
                best_key = key;
                best = i;
            }
        }
        self.tick += 1;
        self.last_used[usize::from(best)] = self.tick;
        self.in_use[usize::from(best)] += 1;
        best
    }

    /// Return a color to the pool (its lane segment ended).
    pub fn release(&mut self, color: u8) {
        if let Some(c) = self.in_use.get_mut(usize::from(color)) {
            *c = c.saturating_sub(1);
        }
    }

    /// Number of colors currently held by active lanes.
    #[must_use]
    pub fn active(&self) -> usize {
        self.in_use.iter().filter(|c| **c > 0).count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinct_until_exhausted_then_reuse() {
        let mut a = ColorAllocator::new();
        let mut got: Vec<u8> = (0..N).map(|_| a.alloc()).collect();
        got.sort_unstable();
        got.dedup();
        assert_eq!(got.len(), N);
        assert_eq!(a.active(), N);
        assert!(a.alloc() < PALETTE_SIZE);
    }

    #[test]
    fn released_lru_first() {
        let mut a = ColorAllocator::new();
        let c0 = a.alloc();
        let c1 = a.alloc();
        a.release(c0);
        a.release(c1);
        let n = a.alloc();
        assert!(n != c0 && n != c1);
    }
}
